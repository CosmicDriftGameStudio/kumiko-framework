// Integration test for inbound-mail-foundation. Exercises connect/ingest/
// list/disconnect through the full Dispatcher + DB (setupTestStack, real
// HTTP — no fake dispatcher).
//
// Scenarios:
//   - Dedup: 2× identical providerMessageId → 1 Event/Row, duplicate=true
//   - Raw event row: PII is ciphertext in the event store; plaintext is
//     available only through decrypt-on-read queries
//   - Projection rebuild: replaying the event log reproduces the read models
//   - Scope visibility (ownerUserId): personal mailbox is visible only to
//     the owner + TenantAdmin
//   - Crypto shredding: erasing the subject key makes the payload unreadable

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { ROLES } from "@cosmicdrift/kumiko-framework/auth";
import {
  configuredPiiSubjectKms,
  configurePiiSubjectKms,
  decryptPiiFieldValues,
  InMemoryKmsAdapter,
  isPiiCiphertext,
  PII_ERASED_SENTINEL,
} from "@cosmicdrift/kumiko-framework/crypto";
import {
  type DbConnection,
  insertOne,
  selectMany,
} from "@cosmicdrift/kumiko-framework/db";
import { createSystemUser, type TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { loadAggregate } from "@cosmicdrift/kumiko-framework/event-store";
import { rebuildProjection } from "@cosmicdrift/kumiko-framework/pipeline";
import { createTestUser, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { resetPiiSubjectKmsForTests } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import {
  createComplianceProfilesFeature,
  tenantComplianceProfileEntity,
} from "../../compliance-profiles/index.ts";
import { createConfigFeature } from "../../config/index.ts";
import { createInboundProviderInMemoryFeature } from "../../inbound-provider-inmemory/index.ts";
import { createTenantFeature } from "../../tenant/feature.ts";
import { tenantEntity } from "../../tenant/schema/tenant.ts";
import { createTenantLifecycleFeature } from "../../tenant-lifecycle/index.ts";
import { inboundMessageAggregateId } from "../aggregate-id.ts";
import { InboundMailFoundationHandlers, InboundMailFoundationQueries } from "../constants.ts";
import { seenMessageEntity, seenMessageTable, syncCursorEntity } from "../entities.ts";
import { INBOUND_MESSAGE_AGGREGATE_TYPE } from "../events.ts";
import { createInboundMailFoundationFeature } from "../feature.ts";
import { ingestFailureEntity } from "../ingest-failures.ts";
import { inboundMessagesProjectionTable, mailAccountsProjectionTable } from "../projection.ts";
import { quarantineEntity } from "../quarantine-entities.ts";

// =============================================================================
// Setup
// =============================================================================

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
      createInboundProviderInMemoryFeature(),
    ],
  });
  db = stack.db;
  await unsafeCreateEntityTable(db, tenantEntity);
  await unsafeCreateEntityTable(db, tenantComplianceProfileEntity);
  // Direct-write stores are unmanaged: no r.entity and no automatic push.
  await unsafeCreateEntityTable(db, syncCursorEntity);
  await unsafeCreateEntityTable(db, seenMessageEntity);
  await unsafeCreateEntityTable(db, quarantineEntity);
  await unsafeCreateEntityTable(db, ingestFailureEntity);
  // PII fields are tenantOwned; handlers call configuredPiiSubjectKms()
  // directly (raw r.projection, without executor wiring), as run{Prod,Dev}App
  // does at boot.
  configurePiiSubjectKms(new InMemoryKmsAdapter());
});

afterAll(async () => {
  await stack.cleanup();
  resetPiiSubjectKmsForTests();
});

function adminFor(tenantNumber: number) {
  return createTestUser({
    id: tenantNumber,
    tenantId: testTenantId(tenantNumber),
    roles: ["TenantAdmin", "SystemAdmin"],
  });
}

function ingestPayload(
  accountId: string,
  overrides: Partial<{
    ownerUserId: string | null;
    providerMessageId: string;
    messageIdHeader: string | null;
    references: string[];
    from: string;
    subject: string;
    receivedAtIso: string;
  }> = {},
) {
  return {
    accountId,
    ownerUserId: overrides.ownerUserId ?? null,
    providerName: "inmemory",
    providerMessageId: overrides.providerMessageId ?? "uid-1",
    messageIdHeader: overrides.messageIdHeader ?? "msg-1@example.com",
    providerThreadId: null,
    references: overrides.references ?? [],
    from: overrides.from ?? "sender@example.com",
    to: ["inbox@tenant.example"],
    cc: [],
    subject: overrides.subject ?? "Hello",
    snippet: "Hello world …",
    receivedAtIso: overrides.receivedAtIso ?? "2026-07-01T10:00:00Z",
    bodyRef: "",
    scope: "inbox",
    providerCursor: '{"offset":1}',
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
  expect(result.accountId).toBeDefined();
  return result.accountId;
}

// =============================================================================
// Scenarios
// =============================================================================

describe("connect-account + list with decrypt-on-read", () => {
  test("connect creates Stream + Projection row; address is at-rest Ciphertext, list returns plaintext", async () => {
    const admin = adminFor(4001);
    const accountId = await connectSharedAccount(admin);

    // Raw event-log payload: Ciphertext.
    const events = await loadAggregate(db, accountId, admin.tenantId);
    expect(events).toHaveLength(1);
    const payload = events[0]?.payload as { address?: string };
    expect(payload.address).not.toBe("inbox@tenant.example");
    expect(isPiiCiphertext(payload.address)).toBe(true);

    // Raw projection row: Ciphertext.
    const rawRows = await selectMany(db, mailAccountsProjectionTable, { id: accountId });
    expect(rawRows).toHaveLength(1);
    expect(isPiiCiphertext(rawRows[0]?.["address"])).toBe(true);
    expect(rawRows[0]?.["status"]).toBe("active");

    // decrypt-on-read list-query: Klartext.
    const list = (await stack.http.queryOk(
      InboundMailFoundationQueries.listAccounts,
      {},
      admin,
    )) as { rows: Array<Record<string, unknown>> };
    const row = list.rows.find((r) => r["id"] === accountId);
    expect(row?.["address"]).toBe("inbox@tenant.example");
  });
});

describe("scenario 2: ingest-message — Dedup + threadKey", () => {
  test("the same providerMessageId 2× → exactly 1 row, duplicate=true", async () => {
    const admin = adminFor(4002);
    const accountId = await connectSharedAccount(admin);

    const first = (await stack.http.writeOk(
      InboundMailFoundationHandlers.ingestMessage,
      ingestPayload(accountId, { providerMessageId: "uid-1", messageIdHeader: "root@example.com" }),
      admin,
    )) as Record<string, unknown>;
    expect(first["duplicate"]).toBe(false);
    expect(first["inboundMessageAggregateId"]).toBe(inboundMessageAggregateId(accountId, "uid-1"));

    // Replay (IDLE duplicate notification / cursor overlap) → duplicate, no second row.
    const replay = (await stack.http.writeOk(
      InboundMailFoundationHandlers.ingestMessage,
      ingestPayload(accountId, { providerMessageId: "uid-1", messageIdHeader: "root@example.com" }),
      admin,
    )) as Record<string, unknown>;
    expect(replay["duplicate"]).toBe(true);

    const msgRows = await selectMany(db, inboundMessagesProjectionTable, {
      accountId,
    });
    expect(msgRows).toHaveLength(1);

    // Reply im selben Thread (References-Root) → same threadKey.
    const reply = (await stack.http.writeOk(
      InboundMailFoundationHandlers.ingestMessage,
      ingestPayload(accountId, {
        providerMessageId: "uid-2",
        messageIdHeader: "reply-1@example.com",
        references: ["root@example.com"],
        subject: "Re: Hello",
        receivedAtIso: "2026-07-01T11:00:00Z",
      }),
      admin,
    )) as Record<string, unknown>;
    expect(reply["duplicate"]).toBe(false);
    expect(reply["threadKey"]).toBe("mid:root@example.com");

    // Raw message row contains PII ciphertext; message:list returns plaintext.
    expect(isPiiCiphertext(msgRows[0]?.["from"])).toBe(true);
    expect(isPiiCiphertext(msgRows[0]?.["subject"])).toBe(true);
    const list = (await stack.http.queryOk(
      InboundMailFoundationQueries.listMessages,
      { accountId },
      admin,
    )) as { rows: Array<Record<string, unknown>> };
    expect(list.rows).toHaveLength(2);
    const firstRow = list.rows.find((r) => r["messageIdHeader"] === "root@example.com");
    expect(firstRow?.["from"]).toBe("sender@example.com");
    expect(firstRow?.["subject"]).toBe("Hello");
  });
});

describe("ingest-message — concurrent ingests of the same message", () => {
  test("two simultaneous ingests of one providerMessageId store one message and one anchor, both succeed", async () => {
    const admin = adminFor(4031);
    const accountId = await connectSharedAccount(admin);
    const providerMessageId = "same-uid-race";

    const responses = await Promise.all(
      [0, 1].map(() =>
        stack.http.write(
          InboundMailFoundationHandlers.ingestMessage,
          ingestPayload(accountId, { providerMessageId, messageIdHeader: "same@example.com" }),
          admin,
        ),
      ),
    );

    const bodies = await Promise.all(
      responses.map(async (res) => {
        expect(res.status).toBe(200);
        return (await res.json()) as { isSuccess: boolean; data: { duplicate: boolean } };
      }),
    );
    for (const body of bodies) expect(body.isSuccess).toBe(true);
    expect(bodies.filter((body) => body.data.duplicate)).toHaveLength(1);

    expect(await selectMany(db, inboundMessagesProjectionTable, { accountId })).toHaveLength(1);
    expect(await selectMany(db, seenMessageTable, { accountId, providerMessageId })).toHaveLength(
      1,
    );
  });

  test("the database refuses a second anchor for the same account and message", async () => {
    const admin = adminFor(4032);
    const accountId = await connectSharedAccount(admin);
    const anchor = {
      tenantId: admin.tenantId,
      accountId,
      providerMessageId: "anchor-twice",
      seenAt: Temporal.Now.instant().toString(),
    };
    await insertOne(db, seenMessageTable, anchor);

    await expect(insertOne(db, seenMessageTable, anchor)).rejects.toThrow(/duplicate key/);
  });
});

describe("Scope visibility (personal mailbox)", () => {
  test("Only the owner sees messages of a user-scoped account, an admin sees just the account", async () => {
    const tenantNumber = 4003;
    const owner = createTestUser({
      id: 40031,
      tenantId: testTenantId(tenantNumber),
      roles: ["TenantAdmin", "SystemAdmin"],
    });
    const otherUser = createTestUser({
      id: 40032,
      tenantId: testTenantId(tenantNumber),
      roles: ["User"],
    });
    const otherAdmin = createTestUser({
      id: 40033,
      tenantId: testTenantId(tenantNumber),
      roles: ["TenantAdmin"],
    });

    const connect = (await stack.http.writeOk(
      InboundMailFoundationHandlers.connectAccount,
      {
        provider: "inmemory",
        authMethod: "password",
        displayName: "Privat",
        address: "owner@tenant.example",
        scope: "user",
      },
      owner,
    )) as { accountId: string };

    await stack.http.writeOk(
      InboundMailFoundationHandlers.ingestMessage,
      ingestPayload(connect.accountId, {
        ownerUserId: owner.id,
        providerMessageId: "uid-personal-1",
        messageIdHeader: "personal-1@example.com",
      }),
      owner,
    );

    const forOwner = (await stack.http.queryOk(
      InboundMailFoundationQueries.listMessages,
      { accountId: connect.accountId },
      owner,
    )) as { rows: unknown[] };
    expect(forOwner.rows).toHaveLength(1);

    const forOther = (await stack.http.queryOk(
      InboundMailFoundationQueries.listMessages,
      { accountId: connect.accountId },
      otherUser,
    )) as { rows: unknown[] };
    expect(forOther.rows).toHaveLength(0);

    const forAdmin = (await stack.http.queryOk(
      InboundMailFoundationQueries.listMessages,
      { accountId: connect.accountId },
      otherAdmin,
    )) as { rows: unknown[] };
    expect(forAdmin.rows).toHaveLength(0);

    const adminAccounts = (await stack.http.queryOk(
      InboundMailFoundationQueries.listAccounts,
      {},
      otherAdmin,
    )) as { rows: Array<Record<string, unknown>> };
    expect(adminAccounts.rows).toEqual([
      expect.objectContaining({
        id: connect.accountId,
        address: "owner@tenant.example",
        quarantinedCount: 0,
        hasOpenQuarantine: false,
      }),
    ]);
  });
});

describe("message:list — keyset paging", () => {
  test("pages newest first, skips other users' personal mail and ends with a null cursor", async () => {
    const tenantNumber = 4041;
    const admin = adminFor(tenantNumber);
    const reader = createTestUser({
      id: 40412,
      tenantId: testTenantId(tenantNumber),
      roles: ["User"],
    });
    const sharedId = await connectSharedAccount(admin);
    const personal = (await stack.http.writeOk(
      InboundMailFoundationHandlers.connectAccount,
      {
        provider: "inmemory",
        authMethod: "password",
        displayName: "Privat",
        address: "paging-owner@tenant.example",
        scope: "user",
      },
      admin,
    )) as { accountId: string };

    const sharedTimes = [
      "2026-08-01T10:00:00Z",
      "2026-08-01T11:00:00Z",
      "2026-08-01T11:00:00Z",
      "2026-08-01T12:00:00Z",
    ];
    const personalTimes = ["2026-08-01T10:30:00Z", "2026-08-01T11:30:00Z", "2026-08-01T12:30:00Z"];
    for (const [index, receivedAtIso] of sharedTimes.entries()) {
      await stack.http.writeOk(
        InboundMailFoundationHandlers.ingestMessage,
        ingestPayload(sharedId, {
          providerMessageId: `paging-shared-${index}`,
          messageIdHeader: `paging-shared-${index}@example.com`,
          receivedAtIso,
        }),
        admin,
      );
    }
    for (const [index, receivedAtIso] of personalTimes.entries()) {
      await stack.http.writeOk(
        InboundMailFoundationHandlers.ingestMessage,
        ingestPayload(personal.accountId, {
          ownerUserId: admin.id,
          providerMessageId: `paging-personal-${index}`,
          messageIdHeader: `paging-personal-${index}@example.com`,
          receivedAtIso,
        }),
        admin,
      );
    }

    type MessagePage = { rows: Array<Record<string, unknown>>; nextCursor: string | null };
    const all = (await stack.http.queryOk(
      InboundMailFoundationQueries.listMessages,
      { limit: 200 },
      reader,
    )) as MessagePage;
    expect(all.rows).toHaveLength(4);
    expect(all.rows.every((row) => row["accountId"] === sharedId)).toBe(true);
    const receivedAts = all.rows.map((row) => String(row["receivedAt"]));
    for (let i = 1; i < receivedAts.length; i++) {
      expect((receivedAts[i - 1] ?? "") >= (receivedAts[i] ?? "")).toBe(true);
    }
    expect(all.nextCursor).toBeNull();

    const pagedIds: unknown[] = [];
    let cursor: string | undefined;
    let lastCursor: string | null = null;
    for (let page = 0; page < 5; page++) {
      const result = (await stack.http.queryOk(
        InboundMailFoundationQueries.listMessages,
        { limit: 2, ...(cursor !== undefined && { cursor }) },
        reader,
      )) as MessagePage;
      expect(result.rows.length).toBeLessThanOrEqual(2);
      pagedIds.push(...result.rows.map((row) => row["id"]));
      lastCursor = result.nextCursor;
      if (lastCursor === null) break;
      cursor = lastCursor;
    }
    expect(lastCursor).toBeNull();
    expect(pagedIds).toEqual(all.rows.map((row) => row["id"]));
    expect(new Set(pagedIds).size).toBe(pagedIds.length);
  });
});

describe("scenario 4: Account-Lifecycle", () => {
  test("update → disconnect → update is rejected, disconnect is idempotent", async () => {
    const admin = adminFor(4004);
    const accountId = await connectSharedAccount(admin);

    const asAdmin = await stack.http.writeErr(
      InboundMailFoundationHandlers.updateAccount,
      { accountId, status: "degraded" },
      admin,
    );
    expect(JSON.stringify(asAdmin)).toContain("field_requires_system_identity");
    await stack.dispatcher.write(
      InboundMailFoundationHandlers.updateAccount,
      { accountId, status: "degraded", watchState: "backoff:5000ms", reason: "test" },
      createSystemUser(admin.tenantId as TenantId, [ROLES.SystemAdmin]),
    );
    let rows = await selectMany(db, mailAccountsProjectionTable, { id: accountId });
    expect(rows[0]?.["status"]).toBe("degraded");
    // connected_at remains the time of the initial connection because the SET
    // clause omits the column.
    const connectedAt = String(rows[0]?.["connectedAt"]);

    const disconnect = (await stack.http.writeOk(
      InboundMailFoundationHandlers.disconnectAccount,
      { accountId, reason: "test" },
      admin,
    )) as Record<string, unknown>;
    expect(disconnect["alreadyDisconnected"]).toBe(false);
    rows = await selectMany(db, mailAccountsProjectionTable, { id: accountId });
    expect(rows[0]?.["status"]).toBe("disconnected");
    expect(String(rows[0]?.["connectedAt"])).toBe(connectedAt);

    // Idempotent: the second disconnect is a successful no-op.
    const again = (await stack.http.writeOk(
      InboundMailFoundationHandlers.disconnectAccount,
      { accountId, reason: "test" },
      admin,
    )) as Record<string, unknown>;
    expect(again["alreadyDisconnected"]).toBe(true);

    // Updating a disconnected account returns 422; a supervisor race must not
    // revive a disconnected account.
    const err = await stack.dispatcher.write(
      InboundMailFoundationHandlers.updateAccount,
      { accountId, status: "active", reason: "test" },
      createSystemUser(admin.tenantId as TenantId, [ROLES.SystemAdmin]),
    );
    expect(err.isSuccess).toBe(false);
    expect(JSON.stringify(err)).toContain("account_disconnected");
  });
});

describe("scenario 5: Projection-Rebuild reproduziert die Read-Models (Plan §3.4)", () => {
  test("rebuild from event log → identical inbound-message-Rows", async () => {
    const admin = adminFor(4005);
    const accountId = await connectSharedAccount(admin);
    await stack.http.writeOk(
      InboundMailFoundationHandlers.ingestMessage,
      ingestPayload(accountId, { providerMessageId: "uid-r1", messageIdHeader: "r1@example.com" }),
      admin,
    );
    await stack.http.writeOk(
      InboundMailFoundationHandlers.ingestMessage,
      ingestPayload(accountId, {
        providerMessageId: "uid-r2",
        messageIdHeader: "r2@example.com",
        references: ["r1@example.com"],
        receivedAtIso: "2026-07-02T09:00:00Z",
      }),
      admin,
    );

    const before = await selectMany(db, inboundMessagesProjectionTable, { accountId });
    expect(before).toHaveLength(2);

    const result = await rebuildProjection("inbound-mail-foundation:projection:inbound-message", {
      db,
      registry: stack.registry,
    });
    expect(result.eventsProcessed).toBeGreaterThanOrEqual(2);

    const after = await selectMany(db, inboundMessagesProjectionTable, { accountId });
    expect(after).toHaveLength(2);
    const key = (rows: readonly Record<string, unknown>[]) =>
      rows.map((r) => `${r["id"]}|${r["threadKey"]}|${r["from"]}|${r["subject"]}`).sort();
    expect(key(after)).toEqual(
      key(before),
    );
  });
});

describe("Record-key erase makes one mail's event payload permanently unreadable", () => {
  test("erasing a mail's record key makes only that mail's event payload unreadable", async () => {
    const admin = adminFor(4006);
    const accountId = await connectSharedAccount(admin);
    await stack.http.writeOk(
      InboundMailFoundationHandlers.ingestMessage,
      ingestPayload(accountId, {
        providerMessageId: "uid-shred",
        messageIdHeader: "shred@example.com",
        from: "secret-sender@example.com",
      }),
      admin,
    );

    await stack.http.writeOk(
      InboundMailFoundationHandlers.ingestMessage,
      ingestPayload(accountId, {
        providerMessageId: "uid-keep",
        messageIdHeader: "keep@example.com",
        from: "kept-sender@example.com",
      }),
      admin,
    );

    const events = await loadAggregate(
      db,
      inboundMessageAggregateId(accountId, "uid-shred"),
      admin.tenantId,
    );
    const keptEvents = await loadAggregate(
      db,
      inboundMessageAggregateId(accountId, "uid-keep"),
      admin.tenantId,
    );
    const keptCiphertext = (keptEvents[0]!.payload as { from?: string }).from as string;
    const ciphertext = (events[0]!.payload as { from?: string }).from as string;
    expect(isPiiCiphertext(ciphertext)).toBe(true);

    const kms = configuredPiiSubjectKms();
    if (!kms) throw new Error("expected a configured PII-subject KMS in this test stack");
    await kms.eraseKey(
      {
        kind: "record",
        entity: INBOUND_MESSAGE_AGGREGATE_TYPE,
        id: inboundMessageAggregateId(accountId, "uid-shred"),
      },
      { requestId: "test:crypto-shred", eraseReason: "test" },
    );

    const decrypted = await decryptPiiFieldValues({ from: ciphertext }, ["from"], kms, {
      requestId: "test:crypto-shred-verify",
    });
    expect(decrypted["from"]).toBe(PII_ERASED_SENTINEL);
    expect(decrypted["from"]).not.toBe("secret-sender@example.com");

    const kept = await decryptPiiFieldValues({ from: keptCiphertext }, ["from"], kms, {
      requestId: "test:crypto-shred-keep",
    });
    expect(kept["from"]).toBe("kept-sender@example.com");
  });
});
