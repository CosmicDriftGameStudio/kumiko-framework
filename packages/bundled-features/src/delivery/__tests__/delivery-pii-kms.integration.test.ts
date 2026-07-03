// Delivery-attempt log under KMS (#799): recipientAddress is written via
// LOW-LEVEL append() in attempt-log.ts — the event-PII catalog must cover
// it. Stored event + projected row carry ciphertext under the recipient's
// DEK, the outgoing mail still reaches the PLAINTEXT address, the admin
// log.query decrypts for display, and erasing the recipient's key flips
// the log entry to [[erased]] without touching the append-only stream.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  configurePiiSubjectKms,
  InMemoryKmsAdapter,
  isPiiCiphertext,
  PII_ERASED_SENTINEL,
  resetPiiSubjectKmsForTests,
} from "@cosmicdrift/kumiko-framework/crypto";
import {
  defineFeature,
  defineWriteHandler,
  type NotifyFn,
  qn,
} from "@cosmicdrift/kumiko-framework/engine";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  TestUsers,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import { z } from "zod";
import { createChannelEmailFeature } from "../../channel-email/feature";
import { createInMemoryTransport } from "../../channel-email/types";
import { createConfigFeature } from "../../config/feature";
import { configValuesTable } from "../../config/table";
import { createRendererFoundationFeature } from "../../renderer-foundation/feature";
import { createRendererSimpleFeature } from "../../renderer-simple/feature";
import { simpleRenderer } from "../../renderer-simple/simple-renderer";
import { createTemplateResolverFeature } from "../../template-resolver/feature";
import { createTenantFeature } from "../../tenant/feature";
import { tenantMembershipsTable } from "../../tenant/membership-table";
import { DELIVERY_ATTEMPT_EVENT } from "../constants";
import { createDeliveryFeature } from "../feature";
import { deliveryAttemptsTable, notificationPreferencesTable } from "../tables";
import { createDeliveryTestContext } from "../testing";

const emailTransport = createInMemoryTransport();
const testEmail = (userId: string | number) => `user-${userId}@test.com`;

const admin = TestUsers.admin;
const recipient = createTestUser({ id: 7, roles: ["User"] });

const appFeature = defineFeature("app", (r) => {
  r.requires("delivery");

  r.writeHandler(
    defineWriteHandler({
      name: "ping",
      schema: z.object({ toUserId: z.string() }),
      handler: async (event, ctx) => {
        const notify = ctx.notify as NotifyFn;
        await notify(qn("app", "notify", "pinged"), {
          to: event.payload.toUserId,
          data: { title: "Ping", body: "Du wurdest angepingt" },
        });
        return { isSuccess: true, data: { sent: true } };
      },
      access: { openToAll: true },
    }),
  );
});

let stack: TestStack;
let kms: InMemoryKmsAdapter;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createTenantFeature(),
      createTemplateResolverFeature(),
      createRendererFoundationFeature(),
      createDeliveryFeature(),
      createRendererSimpleFeature(),
      createChannelEmailFeature({
        transport: emailTransport,
        renderer: simpleRenderer,
        resolveEmail: async (userId) => testEmail(userId),
      }),
      appFeature,
    ],
    extraContext: (deps) => createDeliveryTestContext(deps),
  });

  await unsafePushTables(stack.db, {
    configValuesTable,
    tenantMembershipsTable,
    notificationPreferencesTable,
  });
});

afterAll(async () => {
  await stack.cleanup();
});

// ONE kms for the whole file: rows persist across tests, so a fresh adapter
// per test would orphan earlier ciphertext (decrypt fails loud on KeyNotFound).
beforeEach(() => {
  kms ??= new InMemoryKmsAdapter();
  configurePiiSubjectKms(kms);
  emailTransport.sent.length = 0;
});

afterAll(() => {
  resetPiiSubjectKmsForTests();
});

async function pingRecipient(): Promise<void> {
  await stack.http.writeOk(qn("app", "write", "ping"), { toUserId: recipient.id }, admin);
}

describe("delivery attempt log under KMS", () => {
  test("mail goes to the plaintext address; event + row store ciphertext", async () => {
    await pingRecipient();

    expect(emailTransport.sent.length).toBe(1);
    expect(emailTransport.sent[0]?.to).toBe(testEmail(recipient.id));

    const events = await selectMany(stack.db, eventsTable, { type: DELIVERY_ATTEMPT_EVENT });
    const sent = events
      .map((e) => e.payload as Record<string, unknown>)
      .find((p) => p["channel"] === "email" && p["status"] === "sent");
    expect(sent).toBeDefined();
    expect(isPiiCiphertext(sent?.["recipientAddress"])).toBe(true);
    expect(String(sent?.["recipientAddress"])).toContain(`user:${recipient.id}`);
    expect(sent?.["recipientId"]).toBe(recipient.id);

    const rows = await selectMany(stack.db, deliveryAttemptsTable, {
      recipientId: recipient.id,
      channel: "email",
    });
    expect(rows.length).toBeGreaterThan(0);
    expect(isPiiCiphertext(rows[0]?.["recipientAddress"])).toBe(true);
  });

  test("admin log.query decrypts for display; after key-erase it shows [[erased]]", async () => {
    await pingRecipient();

    const before = await stack.http.queryOk<{ rows: Record<string, unknown>[] }>(
      "delivery:query:log",
      { limit: 100 },
      admin,
    );
    const entry = before.rows.find(
      (r) => r["recipientId"] === recipient.id && r["channel"] === "email",
    );
    expect(entry?.["recipientAddress"]).toBe(testEmail(recipient.id));

    await kms.eraseKey(
      { kind: "user", userId: recipient.id },
      { requestId: "t", eraseReason: "test-forget" },
    );

    const after = await stack.http.queryOk<{ rows: Record<string, unknown>[] }>(
      "delivery:query:log",
      { limit: 100 },
      admin,
    );
    const erased = after.rows.find(
      (r) => r["recipientId"] === recipient.id && r["channel"] === "email",
    );
    expect(erased?.["recipientAddress"]).toBe(PII_ERASED_SENTINEL);
  });
});
