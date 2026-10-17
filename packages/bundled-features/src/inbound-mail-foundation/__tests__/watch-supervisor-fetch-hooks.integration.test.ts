// What the supervisor hands a provider plugin on fetch: the context's metricsFor and the
// known-id filter that lets a provider skip MIME downloads for already ingested messages.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { ROLES } from "@cosmicdrift/kumiko-framework/auth";
import { configurePiiSubjectKms, InMemoryKmsAdapter } from "@cosmicdrift/kumiko-framework/crypto";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import {
  createSystemUser,
  defineFeature,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import type { MetricsHandle } from "@cosmicdrift/kumiko-framework/observability";
import { createTestUser, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { resetPiiSubjectKmsForTests } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import {
  createComplianceProfilesFeature,
  tenantComplianceProfileEntity,
} from "../../compliance-profiles/index.js";
import { createConfigFeature } from "../../config/index.js";
import { createTenantFeature } from "../../tenant/feature.js";
import { tenantEntity } from "../../tenant/schema/tenant.js";
import { createTenantLifecycleFeature } from "../../tenant-lifecycle/index.js";
import {
  createInboundMailFoundationFeature,
  createInboundMailSupervisor,
  INBOUND_MAIL_PROVIDER_EXTENSION,
  type InboundMailContext,
  InboundMailFoundationHandlers,
  type InboundMailProviderPlugin,
  type RawInboundMessage,
  seenMessageEntity,
  syncCursorEntity,
} from "../index.js";

const PROBE_PROVIDER_KEY = "probe";

type FetchCall = {
  readonly metricsFor: InboundMailContext["metricsFor"];
  readonly unknownIds: readonly string[] | undefined;
};

const listingByAccount = new Map<string, readonly string[]>();
const fetchCallsByAccount = new Map<string, FetchCall[]>();

function rawMsg(providerMessageId: string): RawInboundMessage {
  return {
    providerMessageId,
    messageIdHeader: `${providerMessageId}@example.com`,
    providerThreadId: null,
    references: [],
    from: "sender@example.com",
    to: ["inbox@tenant.example"],
    cc: [],
    subject: `Subject ${providerMessageId}`,
    snippet: "snippet",
    receivedAtIso: "2026-07-15T10:00:00Z",
    rawMime: null,
    scope: "inbox",
  };
}

const probePlugin: InboundMailProviderPlugin = {
  verify: async () => {},
  fetch: async (ctx, account, _cursor, opts) => {
    const listing = listingByAccount.get(account.id) ?? [];
    const unknown = await opts.filterUnknownMessageIds?.(listing);
    const calls = fetchCallsByAccount.get(account.id) ?? [];
    calls.push({ metricsFor: ctx.metricsFor, unknownIds: unknown && [...unknown] });
    fetchCallsByAccount.set(account.id, calls);
    return {
      messages: (unknown ? [...unknown] : []).map(rawMsg),
      nextCursor: { calls: calls.length },
      hasMore: false,
    };
  },
};

const probeProviderFeature = defineFeature("inbound-provider-probe", (r) => {
  r.requires({ features: ["inbound-mail-foundation"] });
  r.useExtension(INBOUND_MAIL_PROVIDER_EXTENSION, PROBE_PROVIDER_KEY, probePlugin);
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
  configurePiiSubjectKms(new InMemoryKmsAdapter());
});

afterAll(async () => {
  await stack.cleanup();
  resetPiiSubjectKmsForTests();
});

beforeEach(() => {
  listingByAccount.clear();
  fetchCallsByAccount.clear();
});

async function connectProbeAccount(tenantNumber: number): Promise<string> {
  const admin = createTestUser({
    id: tenantNumber,
    tenantId: testTenantId(tenantNumber),
    roles: ["TenantAdmin", "SystemAdmin"],
  });
  const result = (await stack.http.writeOk(
    InboundMailFoundationHandlers.connectAccount,
    {
      provider: PROBE_PROVIDER_KEY,
      authMethod: "password",
      displayName: "Team-Inbox",
      address: "inbox@tenant.example",
      scope: "shared",
    },
    admin,
  )) as { accountId: string };
  return result.accountId;
}

function createSupervisor(providerCtx: InboundMailContext = { registry: stack.registry }) {
  return createInboundMailSupervisor({
    providerCtx,
    db,
    dispatchWrite: ({ handlerQn, payload, tenantId }) =>
      stack.dispatcher.write(
        handlerQn,
        payload,
        createSystemUser(tenantId as TenantId, [ROLES.SystemAdmin]),
      ),
    pollIntervalMs: 60_000,
  });
}

function lastUnknownIds(accountId: string): readonly string[] | undefined {
  return fetchCallsByAccount.get(accountId)?.at(-1)?.unknownIds;
}

describe("watch-supervisor — fetch context", () => {
  test("the provider context carries the metricsFor the supervisor was given", async () => {
    const accountId = await connectProbeAccount(4301);
    const metricsFor = (): MetricsHandle => ({ inc() {}, observe() {}, set() {} });

    await createSupervisor({ registry: stack.registry, metricsFor }).pollOnce();

    expect(fetchCallsByAccount.get(accountId)?.[0]?.metricsFor).toBe(metricsFor);
  });
});

describe("watch-supervisor — filterUnknownMessageIds", () => {
  test("after an ingest only the not yet ingested ids come back", async () => {
    const accountId = await connectProbeAccount(4302);
    const supervisor = createSupervisor();
    listingByAccount.set(accountId, ["known-1", "known-2"]);

    await supervisor.pollOnce();
    expect(lastUnknownIds(accountId)).toEqual(["known-1", "known-2"]);

    listingByAccount.set(accountId, ["known-1", "known-2", "fresh-3"]);
    await supervisor.pollOnce();

    expect(lastUnknownIds(accountId)).toEqual(["fresh-3"]);
  });

  test("an empty listing yields an empty set", async () => {
    const accountId = await connectProbeAccount(4303);
    listingByAccount.set(accountId, []);

    await createSupervisor().pollOnce();

    expect(lastUnknownIds(accountId)).toEqual([]);
  });

  test("the same provider id ingested for another account and tenant still counts as unknown", async () => {
    const ingestedAccountId = await connectProbeAccount(4304);
    const otherAccountId = await connectProbeAccount(4305);
    const supervisor = createSupervisor();
    listingByAccount.set(ingestedAccountId, ["shared-id"]);
    await supervisor.pollOnce();
    expect(lastUnknownIds(ingestedAccountId)).toEqual(["shared-id"]);

    listingByAccount.set(otherAccountId, ["shared-id"]);
    await supervisor.pollOnce();

    expect(lastUnknownIds(otherAccountId)).toEqual(["shared-id"]);
    listingByAccount.set(ingestedAccountId, ["shared-id"]);
    await supervisor.pollOnce();
    expect(lastUnknownIds(ingestedAccountId)).toEqual([]);
  });
});
