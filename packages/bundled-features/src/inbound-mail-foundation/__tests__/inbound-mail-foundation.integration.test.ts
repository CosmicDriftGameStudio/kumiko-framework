// Integration-test für inbound-mail-foundation. Treibt connect/ingest/
// list/disconnect durch den full Dispatcher + DB (setupTestStack, echte
// HTTP — kein Fake-Dispatcher).
//
// Plan-Pflicht-Szenarien (§6 Phase 1):
//   - Dedup: 2× dieselbe providerMessageId → 1 Event/Row, duplicate=true
//   - Raw-Event-Row: PII als Ciphertext im Event-Store, Klartext nur
//     über die decrypt-on-read-Queries
//   - Projection-Rebuild: Event-Log-Replay reproduziert die Read-Models
//   - Scope-Sichtbarkeit (ownerUserId): persönliches Postfach nur für
//     Owner + TenantAdmin
//   - Crypto-Shredding: Subject-Key-Erase macht Payload unlesbar (#800)

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { asRawClient, selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  configuredPiiSubjectKms,
  configurePiiSubjectKms,
  decryptPiiFieldValues,
  InMemoryKmsAdapter,
  isPiiCiphertext,
  PII_ERASED_SENTINEL,
  resetPiiSubjectKmsForTests,
} from "@cosmicdrift/kumiko-framework/crypto";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import {
  append,
  createEventsTable,
  getStreamVersion,
  loadAggregate,
} from "@cosmicdrift/kumiko-framework/event-store";
import { rebuildProjection } from "@cosmicdrift/kumiko-framework/pipeline";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  testTenantId,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import {
  createComplianceProfilesFeature,
  tenantComplianceProfileEntity,
} from "../../compliance-profiles";
import { createConfigFeature } from "../../config";
import { inboundProviderInMemoryFeature } from "../../inbound-provider-inmemory";
import { createTenantFeature } from "../../tenant/feature";
import { createTenantLifecycleFeature } from "../../tenant-lifecycle";
import { inboundMessageAggregateId, mailThreadAggregateId } from "../aggregate-id";
import { InboundMailFoundationHandlers, InboundMailFoundationQueries } from "../constants";
import { seenMessageEntity, syncCursorEntity } from "../entities";
import {
  MAIL_THREAD_AGGREGATE_TYPE,
  MAIL_THREAD_UPDATED_EVENT_QN,
  type MailThreadEventPayload,
} from "../events";
import { inboundMailFoundationFeature } from "../feature";
import {
  inboundMessagesProjectionTable,
  mailAccountsProjectionTable,
  mailThreadsProjectionTable,
} from "../projection";

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
      inboundMailFoundationFeature,
      inboundProviderInMemoryFeature,
    ],
  });
  db = stack.db;
  await createEventsTable(db);
  await unsafeCreateEntityTable(db, tenantComplianceProfileEntity);
  // Unmanaged direct-write stores — kein r.entity, kein Auto-Push.
  await unsafeCreateEntityTable(db, syncCursorEntity);
  await unsafeCreateEntityTable(db, seenMessageEntity);
  // PII-Felder sind tenantOwned — Handler rufen configuredPiiSubjectKms()
  // direkt (raw r.projection, kein Executor-Wiring), wie run{Prod,Dev}App
  // at boot.
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

describe("scenario 1: connect-account + list mit decrypt-on-read", () => {
  test("connect legt Stream + Projection-Row an; address ist at-rest Ciphertext, list liefert Klartext", async () => {
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

describe("scenario 2: ingest-message — Dedup + Thread-Rollup", () => {
  test("dieselbe providerMessageId 2× → genau 1 Row, duplicate=true; Thread zählt korrekt", async () => {
    const admin = adminFor(4002);
    const accountId = await connectSharedAccount(admin);

    const first = (await stack.http.writeOk(
      InboundMailFoundationHandlers.ingestMessage,
      ingestPayload(accountId, { providerMessageId: "uid-1", messageIdHeader: "root@example.com" }),
      admin,
    )) as Record<string, unknown>;
    expect(first["duplicate"]).toBe(false);
    expect(first["inboundMessageAggregateId"]).toBe(inboundMessageAggregateId(accountId, "uid-1"));

    // Replay (IDLE-Doppel-Notify / Cursor-Overlap) → duplicate, kein 2. Row.
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

    // Reply im selben Thread (References-Root) → Thread-Count 2.
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
    expect(reply["threadAggregateId"]).toBe(
      mailThreadAggregateId(admin.tenantId, "mid:root@example.com"),
    );

    const threadRows = await selectMany(db, mailThreadsProjectionTable, {
      id: mailThreadAggregateId(admin.tenantId, "mid:root@example.com"),
    });
    expect(threadRows).toHaveLength(1);
    expect(threadRows[0]?.["messageCount"]).toBe(2);
    expect(String(threadRows[0]?.["lastMessageAt"])).toContain("2026-07-01T11:00:00");

    // Raw message row: PII-Ciphertext; message:list liefert Klartext.
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

describe("scenario 2b: ingest-message — Thread-Rollup selbstkorrigierend statt kumulativ", () => {
  test("nach einem Race-verzerrten (zu niedrigen) messageCount-Event korrigiert der naechste ingest auf den echten Row-Count", async () => {
    const admin = adminFor(4021);
    const accountId = await connectSharedAccount(admin);

    await stack.http.writeOk(
      InboundMailFoundationHandlers.ingestMessage,
      ingestPayload(accountId, {
        providerMessageId: "self-heal-root",
        messageIdHeader: "self-heal-root@example.com",
      }),
      admin,
    );
    await stack.http.writeOk(
      InboundMailFoundationHandlers.ingestMessage,
      ingestPayload(accountId, {
        providerMessageId: "self-heal-reply-1",
        messageIdHeader: "self-heal-reply-1@example.com",
        references: ["self-heal-root@example.com"],
      }),
      admin,
    );
    const threadAggId = mailThreadAggregateId(admin.tenantId, "mid:self-heal-root@example.com");

    // Simuliert den Snapshot-Drift, den ein verlorener Version-Conflict-
    // Retry (siehe Handler-Kommentar Schritt 5) theoretisch trotz der
    // Retry-Schleife hinterlassen könnte: 2 Message-Rows liegen vor, aber
    // der ZULETZT geschriebene Thread-Event trägt einen zu niedrigen
    // Snapshot. Der neue ingest liest den Live-COUNT gegen
    // read_inbound_messages neu statt dem Event-Snapshot zu vertrauen —
    // der Fehler ist selbstkorrigierend, nicht kumulativ.
    const expectedVersion = await getStreamVersion(db, threadAggId, admin.tenantId);
    const corruptedPayload: MailThreadEventPayload = {
      threadKey: "mid:self-heal-root@example.com",
      subject: "corrupted-by-race",
      lastMessageAtIso: "2026-07-01T10:00:00Z",
      messageCount: 1,
    };
    await append(db, {
      aggregateId: threadAggId,
      aggregateType: MAIL_THREAD_AGGREGATE_TYPE,
      tenantId: admin.tenantId,
      expectedVersion,
      type: MAIL_THREAD_UPDATED_EVENT_QN,
      payload: corruptedPayload,
      metadata: { userId: admin.id },
    });
    // mailThreadsProjectionTable ist executor-only (WritableTable-Typecheck
    // lehnt raw updateMany ab) — die Test-Korruption geht bewusst am
    // Type-Guard vorbei, genau wie die Race-Situation die sie simuliert.
    await asRawClient(db).unsafe(`UPDATE "read_mail_threads" SET message_count = 1 WHERE id = $1`, [
      threadAggId,
    ]);

    await stack.http.writeOk(
      InboundMailFoundationHandlers.ingestMessage,
      ingestPayload(accountId, {
        providerMessageId: "self-heal-reply-2",
        messageIdHeader: "self-heal-reply-2@example.com",
        references: ["self-heal-root@example.com"],
      }),
      admin,
    );

    const healed = await selectMany(db, mailThreadsProjectionTable, { id: threadAggId });
    expect(healed).toHaveLength(1);
    expect(healed[0]?.["messageCount"]).toBe(3);
  });
});

describe("scenario 2c: ingest-message — concurrent thread-rollup race (issue #1229)", () => {
  // Probabilistic — looped per house convention (mehrere Durchläufe, z.B.
  // 20x): the version-conflict race between two step-5 thread-rollup
  // appends only fires on genuine transaction-timing interleaving, which
  // a single run can't force deterministically.
  const ITERATIONS = 20;
  const CONCURRENCY = 3;

  test(`${CONCURRENCY} concurrent ingests of different messages in the same thread never 500 and converge on the correct messageCount, ${ITERATIONS} rounds`, async () => {
    const admin = adminFor(4022);
    const accountId = await connectSharedAccount(admin);

    for (let round = 0; round < ITERATIONS; round++) {
      const rootMessageIdHeader = `race-root-${round}@example.com`;

      const responses = await Promise.all(
        Array.from({ length: CONCURRENCY }, (_, n) =>
          stack.http.write(
            InboundMailFoundationHandlers.ingestMessage,
            ingestPayload(accountId, {
              providerMessageId: `race-${round}-${n}`,
              messageIdHeader: `race-${round}-${n}@example.com`,
              references: [rootMessageIdHeader],
            }),
            admin,
          ),
        ),
      );

      // No writer's transaction fails with a 500 from the thread-rollup
      // version conflict — each of the CONCURRENCY distinct messages is
      // its own aggregate, so step 4 never races; only step 5 (shared
      // threadAggId) does, and the bounded retry loop must absorb it.
      for (const res of responses) {
        expect(res.status).toBe(200);
        const body = (await res.json()) as { isSuccess: boolean; data: { duplicate: boolean } };
        expect(body.isSuccess).toBe(true);
        expect(body.data.duplicate).toBe(false);
      }

      const threadAggId = mailThreadAggregateId(admin.tenantId, `mid:${rootMessageIdHeader}`);
      const threadRows = await selectMany(db, mailThreadsProjectionTable, { id: threadAggId });
      expect(threadRows).toHaveLength(1);
      // Every message's contribution landed — no drift from a silently
      // stale-read-and-succeed append (the bug the retry loop replaces).
      expect(threadRows[0]?.["messageCount"]).toBe(CONCURRENCY);
    }
  });
});

describe("scenario 3: Scope-Sichtbarkeit (persönliches Postfach)", () => {
  test("Messages eines user-scoped Accounts sieht nur der Owner (+ TenantAdmin)", async () => {
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
    expect(forAdmin.rows).toHaveLength(1);
  });
});

describe("scenario 4: Account-Lifecycle", () => {
  test("update → disconnect → update wird abgelehnt, disconnect ist idempotent", async () => {
    const admin = adminFor(4004);
    const accountId = await connectSharedAccount(admin);

    await stack.http.writeOk(
      InboundMailFoundationHandlers.updateAccount,
      { accountId, status: "degraded", watchState: "backoff:5000ms", reason: "test" },
      admin,
    );
    let rows = await selectMany(db, mailAccountsProjectionTable, { id: accountId });
    expect(rows[0]?.["status"]).toBe("degraded");
    // connected_at bleibt der Erst-Connect-Zeitpunkt (SET-Klausel lässt
    // die Spalte aus).
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

    // Idempotent: zweiter disconnect ist success-no-op.
    const again = (await stack.http.writeOk(
      InboundMailFoundationHandlers.disconnectAccount,
      { accountId, reason: "test" },
      admin,
    )) as Record<string, unknown>;
    expect(again["alreadyDisconnected"]).toBe(true);

    // update auf disconnected Account → 422 (kein Supervisor-Race darf
    // einen getrennten Account wiederbeleben).
    const err = await stack.http.writeErr(
      InboundMailFoundationHandlers.updateAccount,
      { accountId, status: "active", reason: "test" },
      admin,
    );
    expect(err.httpStatus).toBe(422);
  });
});

describe("scenario 5: Projection-Rebuild reproduziert die Read-Models (Plan §3.4)", () => {
  test("rebuild aus dem Event-Log → identische inbound-message-Rows", async () => {
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
    const key = (rows: Array<Record<string, unknown>>) =>
      rows.map((r) => `${r["id"]}|${r["threadKey"]}|${r["from"]}|${r["subject"]}`).sort();
    expect(key(after as Array<Record<string, unknown>>)).toEqual(
      key(before as Array<Record<string, unknown>>),
    );

    // Thread-Rollup ebenso rebuild-fähig.
    const threadResult = await rebuildProjection("inbound-mail-foundation:projection:mail-thread", {
      db,
      registry: stack.registry,
    });
    expect(threadResult.eventsProcessed).toBeGreaterThanOrEqual(2);
    const threads = await selectMany(db, mailThreadsProjectionTable, {
      id: mailThreadAggregateId(admin.tenantId, "mid:r1@example.com"),
    });
    expect(threads[0]?.["messageCount"]).toBe(2);
  });
});

describe("scenario 6: crypto-shredding (#800)", () => {
  test("Subject-Key-Erase macht den Event-Payload permanent unlesbar", async () => {
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

    const events = await loadAggregate(
      db,
      inboundMessageAggregateId(accountId, "uid-shred"),
      admin.tenantId,
    );
    const ciphertext = (events[0]?.payload as { from?: string }).from as string;
    expect(isPiiCiphertext(ciphertext)).toBe(true);

    const kms = configuredPiiSubjectKms();
    if (!kms) throw new Error("expected a configured PII-subject KMS in this test stack");
    await kms.eraseKey(
      { kind: "tenant", tenantId: admin.tenantId },
      { requestId: "test:crypto-shred", eraseReason: "test" },
    );

    const decrypted = await decryptPiiFieldValues({ from: ciphertext }, ["from"], kms, {
      requestId: "test:crypto-shred-verify",
    });
    expect(decrypted["from"]).toBe(PII_ERASED_SENTINEL);
    expect(decrypted["from"]).not.toBe("secret-sender@example.com");
  });
});
