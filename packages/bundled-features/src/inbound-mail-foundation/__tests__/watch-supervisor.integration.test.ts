// Watch-supervisor integration — drives createInboundMailSupervisor against
// a real setupTestStack + inbound-provider-inmemory (fetch/watch/error
// injection). Proves poll ingest, IDLE watch push, auth_error quarantine,
// and cursor-invalid resync — not existence checks.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { ROLES } from "@cosmicdrift/kumiko-framework/auth";
import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  configurePiiSubjectKms,
  InMemoryKmsAdapter,
  resetPiiSubjectKmsForTests,
} from "@cosmicdrift/kumiko-framework/crypto";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import { createSystemUser, type TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { createEventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  testTenantId,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { waitFor } from "@cosmicdrift/kumiko-framework/testing";
import {
  createComplianceProfilesFeature,
  tenantComplianceProfileEntity,
} from "../../compliance-profiles";
import { createConfigFeature } from "../../config";
import { inboundProviderInMemoryFeature } from "../../inbound-provider-inmemory";
import {
  emitWatchError,
  failNextFetchWith,
  isWatching,
  resetInboundInMemory,
  seedInboundMessage,
} from "../../inbound-provider-inmemory/feature";
import { createTenantFeature } from "../../tenant/feature";
import { createTenantLifecycleFeature } from "../../tenant-lifecycle";
import {
  createInboundMailSupervisor,
  InboundAuthError,
  InboundCursorInvalidError,
  InboundMailAccountStatuses,
  InboundMailFoundationHandlers,
  InboundRateLimitError,
  inboundMailFoundationFeature,
  inboundMessagesProjectionTable,
  mailAccountsProjectionTable,
  type RawInboundMessage,
  seenMessageEntity,
  syncCursorEntity,
} from "../index";

let stack: TestStack;
let db: DbConnection;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createTenantFeature(),
      createComplianceProfilesFeature(),
      createTenantLifecycleFeature(),
      inboundMailFoundationFeature,
      inboundProviderInMemoryFeature,
    ],
  });
  db = stack.db;
  await createEventsTable(db);
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
  resetInboundInMemory();
});

afterEach(() => {
  resetInboundInMemory();
});

function adminFor(tenantNumber: number) {
  return createTestUser({
    id: tenantNumber,
    tenantId: testTenantId(tenantNumber),
    roles: ["TenantAdmin", "SystemAdmin"],
  });
}

function rawMsg(
  overrides: Partial<RawInboundMessage> & { providerMessageId: string },
): RawInboundMessage {
  return {
    messageIdHeader: `${overrides.providerMessageId}@example.com`,
    providerThreadId: null,
    references: [],
    from: "sender@example.com",
    to: ["inbox@tenant.example"],
    cc: [],
    subject: `Subject ${overrides.providerMessageId}`,
    snippet: "snippet",
    receivedAtIso: "2026-07-15T10:00:00Z",
    rawMime: null,
    scope: "inbox",
    ...overrides,
  };
}

async function connectSharedAccount(admin: ReturnType<typeof adminFor>): Promise<string> {
  const result = (await stack.http.writeOk(
    InboundMailFoundationHandlers.connectAccount,
    {
      provider: "inmemory",
      authMethod: "password",
      displayName: "Team-Inbox",
      address: "inbox@tenant.example",
      scope: "shared",
    },
    admin,
  )) as { accountId: string };
  return result.accountId;
}

function createSupervisor() {
  return createInboundMailSupervisor({
    providerCtx: { registry: stack.registry },
    db,
    dispatchWrite: ({ handlerQn, payload, tenantId }) =>
      stack.dispatcher.write(
        handlerQn,
        payload,
        createSystemUser(tenantId as TenantId, [ROLES.SystemAdmin]),
      ),
    // Keep the periodic tick far away so tests only exercise explicit
    // pollOnce / watch push — not a racing background timer.
    pollIntervalMs: 60_000,
    watchBackoffInitialMs: 50,
    watchBackoffMaxMs: 200,
  });
}

describe("watch-supervisor — poll reconciliation", () => {
  test("pollOnce fetches seeded messages and persists them via ingest-message", async () => {
    const admin = adminFor(4101);
    const accountId = await connectSharedAccount(admin);
    await seedInboundMessage(accountId, rawMsg({ providerMessageId: "poll-uid-1" }));
    await seedInboundMessage(accountId, rawMsg({ providerMessageId: "poll-uid-2" }));

    const supervisor = createSupervisor();
    await supervisor.pollOnce();

    const rows = await selectMany(db, inboundMessagesProjectionTable, { accountId });
    expect(rows).toHaveLength(2);
    const ids = rows.map((r) => r["messageIdHeader"]).sort();
    expect(ids).toEqual(["poll-uid-1@example.com", "poll-uid-2@example.com"]);
  });

  test("second pollOnce is idempotent — Dedup keeps a single row per providerMessageId", async () => {
    const admin = adminFor(4102);
    const accountId = await connectSharedAccount(admin);
    await seedInboundMessage(accountId, rawMsg({ providerMessageId: "poll-dedup-1" }));

    const supervisor = createSupervisor();
    await supervisor.pollOnce();
    await supervisor.pollOnce();

    const rows = await selectMany(db, inboundMessagesProjectionTable, { accountId });
    expect(rows).toHaveLength(1);
  });
});

describe("watch-supervisor — IDLE watch path", () => {
  test("start() arms watch; seedInboundMessage pushes and ingest lands a row", async () => {
    const admin = adminFor(4103);
    const accountId = await connectSharedAccount(admin);
    const supervisor = createSupervisor();
    try {
      await supervisor.start();

      await waitFor(() => {
        expect(isWatching(accountId)).toBe(true);
      });

      await seedInboundMessage(
        accountId,
        rawMsg({ providerMessageId: "watch-uid-1", subject: "via watch" }),
      );

      await waitFor(async () => {
        const rows = await selectMany(db, inboundMessagesProjectionTable, { accountId });
        expect(rows).toHaveLength(1);
      });

      const rows = await selectMany(db, inboundMessagesProjectionTable, { accountId });
      expect(rows[0]?.["messageIdHeader"]).toBe("watch-uid-1@example.com");
    } finally {
      await supervisor.stop();
    }
    expect(isWatching(accountId)).toBe(false);
  });
});

describe("watch-supervisor — error semantics", () => {
  test("InboundAuthError on fetch marks the account auth_error", async () => {
    const admin = adminFor(4104);
    const accountId = await connectSharedAccount(admin);
    failNextFetchWith(accountId, new InboundAuthError("credentials rejected"));

    const supervisor = createSupervisor();
    await supervisor.pollOnce();

    const accounts = await selectMany(db, mailAccountsProjectionTable, { id: accountId });
    expect(accounts).toHaveLength(1);
    expect(accounts[0]?.["status"]).toBe(InboundMailAccountStatuses.authError);
  });

  test("InboundAuthError on live watch stops the watcher and marks auth_error", async () => {
    const admin = adminFor(4106);
    const accountId = await connectSharedAccount(admin);
    const supervisor = createSupervisor();
    try {
      await supervisor.start();
      await waitFor(() => {
        expect(isWatching(accountId)).toBe(true);
      });

      emitWatchError(accountId, new InboundAuthError("token revoked"));

      await waitFor(async () => {
        expect(isWatching(accountId)).toBe(false);
        const accounts = await selectMany(db, mailAccountsProjectionTable, { id: accountId });
        expect(accounts[0]?.["status"]).toBe(InboundMailAccountStatuses.authError);
      });
    } finally {
      await supervisor.stop();
    }
  });

  test("InboundCursorInvalidError resets the cursor; a later poll still ingests", async () => {
    const admin = adminFor(4105);
    const accountId = await connectSharedAccount(admin);
    await seedInboundMessage(accountId, rawMsg({ providerMessageId: "cursor-ok-1" }));

    const supervisor = createSupervisor();
    await supervisor.pollOnce();
    expect(await selectMany(db, inboundMessagesProjectionTable, { accountId })).toHaveLength(1);

    failNextFetchWith(accountId, new InboundCursorInvalidError("uidValidity changed"));
    await supervisor.pollOnce();

    // Account stays active (cursor invalid ≠ auth failure).
    const accounts = await selectMany(db, mailAccountsProjectionTable, { id: accountId });
    expect(accounts[0]?.["status"]).toBe(InboundMailAccountStatuses.active);

    await seedInboundMessage(accountId, rawMsg({ providerMessageId: "cursor-ok-2" }));
    await supervisor.pollOnce();

    const rows = await selectMany(db, inboundMessagesProjectionTable, { accountId });
    expect(rows.map((r) => r["messageIdHeader"]).sort()).toEqual([
      "cursor-ok-1@example.com",
      "cursor-ok-2@example.com",
    ]);
  });

  test("InboundRateLimitError on fetch keeps the account active for the next tick", async () => {
    const admin = adminFor(4107);
    const accountId = await connectSharedAccount(admin);
    failNextFetchWith(accountId, new InboundRateLimitError("slow down", 30_000));

    const supervisor = createSupervisor();
    await supervisor.pollOnce();

    const accounts = await selectMany(db, mailAccountsProjectionTable, { id: accountId });
    expect(accounts[0]?.["status"]).toBe(InboundMailAccountStatuses.active);
  });
});

describe("watch-supervisor — watch restart + ingest resilience", () => {
  test("transient watch error schedules backoff restart and re-arms watch", async () => {
    const admin = adminFor(4108);
    const accountId = await connectSharedAccount(admin);
    const supervisor = createSupervisor();
    try {
      await supervisor.start();
      await waitFor(() => {
        expect(isWatching(accountId)).toBe(true);
      });

      emitWatchError(accountId, new Error("socket dropped"));

      await waitFor(() => {
        expect(isWatching(accountId)).toBe(true);
      });

      const accounts = await selectMany(db, mailAccountsProjectionTable, { id: accountId });
      expect(accounts[0]?.["status"]).toBe(InboundMailAccountStatuses.active);
      expect(String(accounts[0]?.["watchState"])).toMatch(/^watching|backoff:/);
    } finally {
      await supervisor.stop();
    }
  });

  test("watch-ingest failure is logged; poll reconciliation still ingests", async () => {
    const admin = adminFor(4109);
    const accountId = await connectSharedAccount(admin);
    let ingestCalls = 0;
    const supervisor = createInboundMailSupervisor({
      providerCtx: { registry: stack.registry },
      db,
      dispatchWrite: ({ handlerQn, payload, tenantId }) => {
        if (handlerQn === InboundMailFoundationHandlers.ingestMessage) {
          ingestCalls += 1;
          if (ingestCalls === 1) {
            return Promise.resolve({ isSuccess: false, error: { code: "simulated" } });
          }
        }
        return stack.dispatcher.write(
          handlerQn,
          payload,
          createSystemUser(tenantId as TenantId, [ROLES.SystemAdmin]),
        );
      },
      pollIntervalMs: 60_000,
      watchBackoffInitialMs: 50,
      watchBackoffMaxMs: 200,
    });
    try {
      await supervisor.start();
      await waitFor(() => {
        expect(isWatching(accountId)).toBe(true);
      });

      await seedInboundMessage(
        accountId,
        rawMsg({ providerMessageId: "watch-ingest-fail-1", subject: "via watch" }),
      );

      await supervisor.pollOnce();

      const rows = await selectMany(db, inboundMessagesProjectionTable, { accountId });
      expect(rows.some((r) => r["messageIdHeader"] === "watch-ingest-fail-1@example.com")).toBe(
        true,
      );
    } finally {
      await supervisor.stop();
    }
  });

  test("storeBody hook persists raw MIME references on poll ingest", async () => {
    const admin = adminFor(4110);
    const accountId = await connectSharedAccount(admin);
    const stored: string[] = [];
    const supervisor = createInboundMailSupervisor({
      providerCtx: { registry: stack.registry },
      db,
      dispatchWrite: ({ handlerQn, payload, tenantId }) =>
        stack.dispatcher.write(
          handlerQn,
          payload,
          createSystemUser(tenantId as TenantId, [ROLES.SystemAdmin]),
        ),
      storeBody: async (_account, msg) => {
        stored.push(msg.providerMessageId);
        return `body-ref:${msg.providerMessageId}`;
      },
      pollIntervalMs: 60_000,
    });
    await seedInboundMessage(
      accountId,
      rawMsg({
        providerMessageId: "body-store-1",
        rawMime: new TextEncoder().encode("raw-mime-bytes"),
      }),
    );
    await supervisor.pollOnce();
    expect(stored).toEqual(["body-store-1"]);
  });

  test("disconnecting an account tears down its watcher on the next pollOnce", async () => {
    const admin = adminFor(4111);
    const accountId = await connectSharedAccount(admin);
    const supervisor = createSupervisor();
    try {
      await supervisor.start();
      await waitFor(() => {
        expect(isWatching(accountId)).toBe(true);
      });

      await stack.http.writeOk(
        InboundMailFoundationHandlers.disconnectAccount,
        { accountId, reason: "test" },
        admin,
      );
      await supervisor.pollOnce();

      expect(isWatching(accountId)).toBe(false);
    } finally {
      await supervisor.stop();
    }
  });

  test("start() is idempotent — second start does not throw", async () => {
    const supervisor = createSupervisor();
    try {
      await supervisor.start();
      await supervisor.start();
    } finally {
      await supervisor.stop();
    }
  });
});


