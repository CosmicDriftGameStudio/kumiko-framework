// Inbound-Mail Triage Sample — End-to-End Proof
//
// What we're proving (via createAllInOneEntrypoint + BullMQ + Hono — no
// framework-internal shortcuts):
//   1. connect-account creates a mail account (event-sourced stream +
//      projection row).
//   2. ingest-message lands on the HTTP surface (in production the
//      watch-supervisor dispatches it), the inline projection
//      materializes read_inbound_messages, and the handler-trigger
//      fires the worker-lane triage job with the plaintext payload.
//   3. An idempotent replay (same providerMessageId) does NOT create a
//      second message row — and the keyed triage store keeps exactly
//      one item even though the trigger fires again.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  createComplianceProfilesFeature,
  tenantComplianceProfileEntity,
} from "@cosmicdrift/kumiko-bundled-features/compliance-profiles";
import { createConfigFeature } from "@cosmicdrift/kumiko-bundled-features/config";
import {
  InboundMailFoundationHandlers,
  inboundMailFoundationFeature,
  inboundMessageEntity,
  mailAccountEntity,
  mailThreadEntity,
  seenMessageEntity,
  syncCursorEntity,
} from "@cosmicdrift/kumiko-bundled-features/inbound-mail-foundation";
import { inboundProviderInMemoryFeature } from "@cosmicdrift/kumiko-bundled-features/inbound-provider-inmemory";
import { createTenantFeature } from "@cosmicdrift/kumiko-bundled-features/tenant";
import { createTenantLifecycleFeature } from "@cosmicdrift/kumiko-bundled-features/tenant-lifecycle";
import { createRegistry } from "@cosmicdrift/kumiko-framework/engine";
import { createAllInOneEntrypoint } from "@cosmicdrift/kumiko-framework/entrypoint";
import {
  createArchivedStreamsTable,
  createEventsTable,
} from "@cosmicdrift/kumiko-framework/event-store";
import { createEventConsumerStateTable } from "@cosmicdrift/kumiko-framework/pipeline";
import {
  createTestDb,
  createTestRedis,
  type TestDb,
  type TestRedis,
  TestUsers,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { waitFor } from "@cosmicdrift/kumiko-framework/testing";
import { createMailTriageFeature, triageInbox } from "../feature";

const JWT = "inbound-mail-triage-secret-minimum-32-chars!";
const adminUser = { ...TestUsers.systemAdmin, roles: ["SystemAdmin", "TenantAdmin"] };

let testDb: TestDb;
let testRedis: TestRedis;

beforeAll(async () => {
  [testDb, testRedis] = await Promise.all([createTestDb(), createTestRedis()]);
  await createEventsTable(testDb.db);
  await createArchivedStreamsTable(testDb.db);
  await createEventConsumerStateTable(testDb.db);
  // Entity-/Projection-Tables des Flows — der Entrypoint pusht (anders
  // als setupTestStack) keine Tabellen.
  await unsafeCreateEntityTable(testDb.db, tenantComplianceProfileEntity);
  await unsafeCreateEntityTable(testDb.db, mailAccountEntity);
  await unsafeCreateEntityTable(testDb.db, inboundMessageEntity);
  await unsafeCreateEntityTable(testDb.db, mailThreadEntity);
  await unsafeCreateEntityTable(testDb.db, syncCursorEntity);
  await unsafeCreateEntityTable(testDb.db, seenMessageEntity);
});

afterAll(async () => {
  await Promise.all([testDb.cleanup(), testRedis.cleanup()]);
});

function ingestPayload(accountId: string) {
  return {
    accountId,
    ownerUserId: null,
    providerName: "inmemory",
    providerMessageId: "uid-triage-1",
    messageIdHeader: "triage-1@example.com",
    providerThreadId: null,
    references: [],
    from: "Mieterin <mieterin@example.com>",
    to: ["inbox@acme.example"],
    cc: [],
    subject: "Heizung defekt",
    snippet: "Die Heizung im 2. OG faellt seit gestern aus …",
    receivedAtIso: "2026-07-10T08:30:00Z",
    bodyRef: "",
    scope: "inbox",
    providerCursor: '{"offset":1}',
  };
}

describe("inbound-mail triage sample", () => {
  test("inbound mail → ingest → worker-lane triage job; replay stays idempotent", async () => {
    triageInbox.clear();
    const registry = createRegistry([
      createConfigFeature(),
      createTenantFeature(),
      createComplianceProfilesFeature(),
      createTenantLifecycleFeature(),
      inboundMailFoundationFeature,
      inboundProviderInMemoryFeature,
      createMailTriageFeature(),
    ]);
    const redisUrl = `redis://${testRedis.redis.options.host}:${testRedis.redis.options.port}/${testRedis.redis.options.db}`;
    const entry = createAllInOneEntrypoint({
      registry,
      context: { db: testDb.db, redis: testRedis.redis },
      jwtSecret: JWT,
      redisUrl,
      queueNamePrefix: `inbound-mail-triage-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    });
    await entry.start();
    try {
      const token = await entry.jwt.sign(adminUser);
      const headers = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      };

      // 1. Postfach verbinden (shared: ownerUserId=null).
      const connectRes = await entry.app.request("/api/write", {
        method: "POST",
        headers,
        body: JSON.stringify({
          type: InboundMailFoundationHandlers.connectAccount,
          payload: {
            provider: "inmemory",
            authMethod: "password",
            displayName: "Team-Inbox",
            address: "inbox@acme.example",
            scope: "shared",
          },
        }),
      });
      expect(connectRes.status).toBe(200);
      const connectBody = (await connectRes.json()) as {
        data: { accountId: string };
      };
      const accountId = connectBody.data.accountId;
      expect(accountId).toBeDefined();

      // 2. Mail ingest'en — in Produktion dispatcht das der
      //    Watch-Supervisor (IDLE-Push) bzw. der Reconciliation-Poll.
      const ingestRes = await entry.app.request("/api/write", {
        method: "POST",
        headers,
        body: JSON.stringify({
          type: InboundMailFoundationHandlers.ingestMessage,
          payload: ingestPayload(accountId),
        }),
      });
      expect(ingestRes.status).toBe(200);
      const ingestBody = (await ingestRes.json()) as {
        data: { duplicate: boolean };
      };
      expect(ingestBody.data.duplicate).toBe(false);

      // 3. Der Business-Prozess (worker-lane job) feuert asynchron.
      await waitFor(() => triageInbox.size === 1);
      const item = triageInbox.get("uid-triage-1");
      expect(item?.from).toContain("mieterin@example.com");
      expect(item?.subject).toBe("Heizung defekt");
      expect(item?.scope).toBe("inbox");
      expect(item?.threadHint).toBe("triage-1@example.com");

      // 4. Replay (IDLE-Doppel-Notify / Cursor-Overlap): Handler meldet
      //    duplicate, Trigger feuert erneut — der keyed Store bleibt
      //    bei genau einem Item.
      const replayRes = await entry.app.request("/api/write", {
        method: "POST",
        headers,
        body: JSON.stringify({
          type: InboundMailFoundationHandlers.ingestMessage,
          payload: ingestPayload(accountId),
        }),
      });
      expect(replayRes.status).toBe(200);
      const replayBody = (await replayRes.json()) as {
        data: { duplicate: boolean };
      };
      expect(replayBody.data.duplicate).toBe(true);
      // Trigger-Nachlauf abwarten, dann Idempotenz prüfen.
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(triageInbox.size).toBe(1);
    } finally {
      await entry.stop();
    }
  }, 30_000);
});
