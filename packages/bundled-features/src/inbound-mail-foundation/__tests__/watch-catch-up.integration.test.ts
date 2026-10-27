// The watch must start even while the account's sync is still running (a long sync used to
// postpone it until a later tick), and a sync that ran before the mailbox was open cannot be
// trusted to have seen everything, so one more poll follows the watch start.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { ROLES } from "@cosmicdrift/kumiko-framework/auth";
import { configurePiiSubjectKms, InMemoryKmsAdapter } from "@cosmicdrift/kumiko-framework/crypto";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import {
  createSystemUser,
  defineFeature,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import type { DistributedLock } from "@cosmicdrift/kumiko-framework/pipeline";
import { createTestUser, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { resetPiiSubjectKmsForTests, waitFor } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import {
  createComplianceProfilesFeature,
  tenantComplianceProfileEntity,
} from "../../compliance-profiles/index.ts";
import { createConfigFeature } from "../../config/index.ts";
import { createTenantFeature } from "../../tenant/feature.ts";
import { tenantEntity } from "../../tenant/schema/tenant.ts";
import { createTenantLifecycleFeature } from "../../tenant-lifecycle/index.ts";
import {
  createInboundMailFoundationFeature,
  createInboundMailSupervisor,
  INBOUND_MAIL_PROVIDER_EXTENSION,
  InboundMailFoundationHandlers,
  type InboundMailProviderPlugin,
  ingestFailureEntity,
  quarantineEntity,
  seenMessageEntity,
  syncCursorEntity,
} from "../index.ts";

const PROVIDER_KEY = "catch-up-probe";

const fetchCallsOf = new Map<string, number>();
const watchCallsOf = new Map<string, number>();
const gatedAccountIds = new Set<string>();
let releaseGate: () => void = () => {};
const gate = new Promise<void>((resolve) => {
  releaseGate = resolve;
});

function bump(counter: Map<string, number>, accountId: string): number {
  const next = (counter.get(accountId) ?? 0) + 1;
  counter.set(accountId, next);
  return next;
}

const probePlugin: InboundMailProviderPlugin = {
  verify: async () => {},
  fetch: async (_ctx, account) => {
    const call = bump(fetchCallsOf, account.id);
    if (call === 1 && gatedAccountIds.has(account.id)) await gate;
    return { messages: [], nextCursor: { calls: call }, hasMore: false };
  },
  watch: async (_ctx, account) => {
    bump(watchCallsOf, account.id);
    return async () => {};
  },
};

const probeProviderFeature = defineFeature("inbound-provider-catch-up-probe", (r) => {
  r.requires({ features: ["inbound-mail-foundation"] });
  r.useExtension(INBOUND_MAIL_PROVIDER_EXTENSION, PROVIDER_KEY, probePlugin);
});

let stack: TestStack;
let db: DbConnection;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createTenantFeature(),
      createComplianceProfilesFeature(),
      createTenantLifecycleFeature(),
      createInboundMailFoundationFeature(),
      probeProviderFeature,
    ],
  });
  db = stack.db;
  await unsafeCreateEntityTable(db, tenantEntity);
  await unsafeCreateEntityTable(db, tenantComplianceProfileEntity);
  await unsafeCreateEntityTable(db, syncCursorEntity);
  await unsafeCreateEntityTable(db, seenMessageEntity);
  await unsafeCreateEntityTable(db, quarantineEntity);
  await unsafeCreateEntityTable(db, ingestFailureEntity);
  configurePiiSubjectKms(new InMemoryKmsAdapter());
});

afterAll(async () => {
  await stack.cleanup();
  resetPiiSubjectKmsForTests();
});

async function connectProbeAccount(tenantNumber: number): Promise<string> {
  const admin = createTestUser({
    id: tenantNumber,
    tenantId: testTenantId(tenantNumber),
    roles: ["TenantAdmin", "SystemAdmin"],
  });
  const { accountId } = (await stack.http.writeOk(
    InboundMailFoundationHandlers.connectAccount,
    {
      provider: PROVIDER_KEY,
      authMethod: "password",
      displayName: "Team-Inbox",
      address: "inbox@tenant.example",
      scope: "shared",
    },
    admin,
  )) as { accountId: string };
  return accountId;
}

function createSupervisor(lock?: DistributedLock) {
  return createInboundMailSupervisor({
    providerCtx: { registry: stack.registry },
    db,
    dispatchWrite: ({ handlerQn, payload, tenantId }) =>
      stack.dispatcher.write(
        handlerQn,
        payload,
        createSystemUser(tenantId as TenantId, [ROLES.SystemAdmin]),
      ),
    pollIntervalMs: 60 * 60 * 1000,
    ...(lock && { lock }),
  });
}

describe("watch-supervisor — watch start and catch-up poll", () => {
  test("a tick during a running sync starts exactly one watch; a catch-up poll follows the sync", async () => {
    const accountId = await connectProbeAccount(4401);
    gatedAccountIds.add(accountId);

    const supervisor = createSupervisor();
    const startup = supervisor.start();
    try {
      await waitFor(async () => {
        expect(fetchCallsOf.get(accountId)).toBe(1);
      });
      expect(watchCallsOf.get(accountId)).toBeUndefined();

      await supervisor.pollOnce();
      await supervisor.pollOnce();
      expect(watchCallsOf.get(accountId)).toBe(1);
      expect(fetchCallsOf.get(accountId)).toBe(1);

      releaseGate();
      await startup;
      await waitFor(async () => {
        expect(fetchCallsOf.get(accountId)).toBe(2);
      });
      expect(watchCallsOf.get(accountId)).toBe(1);
    } finally {
      releaseGate();
      await startup;
      await supervisor.stop();
    }
  });

  test("a lock that throws once does not block the watch for good; the next tick claims one lease", async () => {
    const accountId = await connectProbeAccount(4402);
    let acquireCalls = 0;
    const lock: DistributedLock = {
      // Accounts of earlier tests live in the same database and are visited by this supervisor too.
      acquire: async (key) => {
        if (key !== accountId) return `foreign-${key}`;
        acquireCalls += 1;
        if (acquireCalls === 1) throw new Error("redis unavailable");
        return `token-${acquireCalls}`;
      },
      renew: async () => true,
      release: async () => true,
    };

    const supervisor = createSupervisor(lock);
    try {
      await supervisor.start();
      expect(watchCallsOf.get(accountId)).toBeUndefined();

      await supervisor.pollOnce();
      await supervisor.pollOnce();
      expect(watchCallsOf.get(accountId)).toBe(1);
      expect(acquireCalls).toBeGreaterThanOrEqual(2);
      const acquiresAfterWatchStart = acquireCalls;

      await supervisor.pollOnce();
      expect(acquireCalls).toBe(acquiresAfterWatchStart);
    } finally {
      await supervisor.stop();
    }
  });
});
