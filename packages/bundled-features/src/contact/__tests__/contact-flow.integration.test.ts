import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  configureBlindIndexKey,
  configurePiiSubjectKms,
  InMemoryKmsAdapter,
} from "@cosmicdrift/kumiko-framework/crypto";
import {
  createEventStoreExecutor,
  createTenantDb,
  fetchOne,
} from "@cosmicdrift/kumiko-framework/db";
import { type SessionUser, SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
import { TestUsers } from "@cosmicdrift/kumiko-framework/seeding";
import { resetPiiSubjectKmsForTests } from "@cosmicdrift/kumiko-testing/helpers";
import { InAppHandlers, InAppQueries } from "../../channel-in-app/index.ts";
import { runRetentionCleanup } from "../../data-retention/run-retention-cleanup.ts";
import { DeliveryQueries } from "../../delivery/index.ts";
import { USER_STATUS, userEntity, userTable } from "../../user/index.ts";
import { runForgetCleanup } from "../../user-data-rights/run-forget-cleanup.ts";
import { runUserExport } from "../../user-data-rights/run-user-export.ts";
import { contactOpenRequestsPanels } from "../panels.ts";
import {
  CONTACT_CLIENT_PATH,
  ContactConfigKeys,
  ContactHandlers,
  ContactQueries,
  contactIdempotencyKeys,
} from "../web/constants.ts";
import {
  loadReplies,
  loadRequests,
  mailsTo,
  postSubmit,
  seedAdmin,
  seedReporter,
  seedRoamingAdmin,
  submitBody,
} from "./contact-helpers.ts";
import {
  type ContactTestStack,
  createContactTestStack,
  emailTransport,
  resetContactTestState,
  TELEGRAM_TOKEN,
} from "./contact-test-stack.ts";

let ctx: ContactTestStack;
let admin: SessionUser;
let secondAdmin: SessionUser;

const userExecutor = createEventStoreExecutor(userTable, userEntity, { entityName: "user" });

beforeAll(async () => {
  resetPiiSubjectKmsForTests();
  ctx = await createContactTestStack();
});

afterAll(async () => {
  ctx.telegram.stop();
  await ctx.stack.cleanup();
});

beforeEach(async () => {
  await resetContactTestState(ctx);
  admin = await seedAdmin(ctx.stack, "admin1@example.com");
  secondAdmin = await seedAdmin(ctx.stack, "admin2@example.com");
});

async function submitAnonymous(email = "ada@example.com"): Promise<string> {
  const res = await postSubmit(ctx.stack, await submitBody(ctx.stack, { email }));
  expect(res.status).toBe(200);
  const row = (await loadRequests(ctx.stack)).find((r) => r["email"] === email);
  if (!row) throw new Error("request missing");
  return String(row["id"]);
}

async function setConfig(key: string, value: string) {
  await ctx.stack.http.writeOk("config:write:set", { key, value, scope: "system" }, admin);
}

describe("contact admin report", () => {
  test("a signed-in user files a report: origin from the session, confirmation by mail", async () => {
    const reporter = await seedReporter(ctx.stack, "rita@example.com", "Reporter GmbH");
    await ctx.stack.http.writeOk(
      ContactHandlers.report,
      {
        kind: "bug",
        subject: "Export fails",
        message: "The export button does nothing.",
      },
      reporter,
    );
    const [row] = await loadRequests(ctx.stack);
    expect(row?.["source"]).toBe("admin");
    expect(row?.["reporterUserId"]).toBe(reporter.id);
    expect(row?.["reporterTenantName"]).toBe("Reporter GmbH");
    expect(row?.["reporterTenantPlan"] ?? null).toBeNull();
    expect(row?.["email"]).toBe("rita@example.com");
    expect(mailsTo("admin1@example.com")).toHaveLength(1);
    expect(mailsTo("rita@example.com")).toHaveLength(1);
  });

  test("an anonymous caller cannot file an admin report", async () => {
    const res = await ctx.stack.http.raw("POST", "/api/write", {
      type: ContactHandlers.report,
      payload: { kind: "bug", subject: "x", message: "y" },
    });
    expect(res.status).toBe(401);
  });
});

describe("contact reply", () => {
  test("an anonymous reporter gets the reply by mail with Reply-To and the quoted request", async () => {
    const requestId = await submitAnonymous();
    emailTransport.sent.length = 0;
    await setConfig(ContactConfigKeys.replyTo, "support@acme.example");

    const result = await ctx.stack.http.writeOk<{ status: string }>(
      ContactHandlers.reply,
      { requestId, message: "Use Settings > Export." },
      admin,
    );
    expect(result.status).toBe("answered");

    const mails = mailsTo("ada@example.com");
    expect(mails).toHaveLength(1);
    expect(mails[0]?.replyTo).toBe("support@acme.example");
    expect(mails[0]?.html).toContain("Use Settings &gt; Export.");
    expect(mails[0]?.html).toContain("How do I export my data?");
    const [row] = await loadRequests(ctx.stack);
    expect(row?.["status"]).toBe("answered");
    expect(row?.["replyCount"]).toBe(1);
    expect(await loadReplies(ctx.stack)).toHaveLength(1);
  });

  test("without a configured reply-to, the replying admin's address is the Reply-To", async () => {
    const requestId = await submitAnonymous();
    emailTransport.sent.length = 0;
    await ctx.stack.http.writeOk(
      ContactHandlers.reply,
      { requestId, message: "Done." },
      secondAdmin,
    );
    expect(mailsTo("ada@example.com")[0]?.replyTo).toBe("admin2@example.com");
  });

  test("markDone closes the request with the reply", async () => {
    const requestId = await submitAnonymous();
    const result = await ctx.stack.http.writeOk<{ status: string }>(
      ContactHandlers.reply,
      { requestId, message: "All good.", markDone: true },
      admin,
    );
    expect(result.status).toBe("done");
    const [row] = await loadRequests(ctx.stack);
    expect(row?.["status"]).toBe("done");
    expect(row?.["closedAt"]).toBeTruthy();
  });

  test("a signed-in reporter gets the mail to the account address and an in-app note", async () => {
    const reporter = await seedReporter(ctx.stack, "rita@example.com");
    await ctx.stack.http.writeOk(
      ContactHandlers.report,
      { kind: "question", subject: "Billing", message: "Where is my invoice?" },
      reporter,
    );
    const [request] = await loadRequests(ctx.stack);
    emailTransport.sent.length = 0;

    await ctx.stack.http.writeOk(
      ContactHandlers.reply,
      { requestId: String(request?.["id"]), message: "Check the billing page." },
      admin,
    );
    expect(mailsTo("rita@example.com")).toHaveLength(1);
    const [reply] = await loadReplies(ctx.stack);
    expect(reply?.["channels"]).toBe("email+inApp");
  });

  test("an unknown request id is a 404 and sends nothing", async () => {
    const failure = await ctx.stack.http.writeErr(
      ContactHandlers.reply,
      { requestId: crypto.randomUUID(), message: "hello" },
      admin,
    );
    expect(failure.httpStatus).toBe(404);
    expect(emailTransport.sent).toHaveLength(0);
  });

  test("an unknown attachment id is refused and the request stays open", async () => {
    const requestId = await submitAnonymous();
    const failure = await ctx.stack.http.writeErr(
      ContactHandlers.reply,
      { requestId, message: "see file", fileIds: [crypto.randomUUID()] },
      admin,
    );
    expect(failure.httpStatus).toBe(422);
    expect(failure.details).toMatchObject({ reason: "contact_attachment_not_found" });
    const [row] = await loadRequests(ctx.stack);
    expect(row?.["status"]).toBe("open");
  });
});

describe("contact telegram and delivery status", () => {
  async function configureTelegram(token: string, chat: string) {
    await ctx.stack.http.writeOk(
      "secrets:write:set",
      { key: "channel-telegram:secret:bot-token", value: token },
      admin,
    );
    await setConfig(ContactConfigKeys.telegramChat, chat);
  }

  type DeliveryRow = { id: string; channel: string; recipient: string; at: string; status: string };

  test("forwards to the configured chat; send-test reports the provider outcome", async () => {
    await configureTelegram(TELEGRAM_TOKEN, "-100123");

    await submitAnonymous();
    const hits = ctx.telegram.hitsOn(`/bot${TELEGRAM_TOKEN}/sendMessage`);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.bodyJson).toMatchObject({ chat_id: "-100123" });
    expect(hits[0]?.bodyText).toContain("New question on Acme");
    expect(hits[0]?.bodyText).not.toContain("How do I export my data?");
    expect(hits[0]?.bodyText).not.toContain("ada@example.com");
    expect(hits[0]?.bodyText).not.toContain("Ada Lovelace");

    const test = await ctx.stack.http.writeOk<{ kind: string }>(
      ContactHandlers.sendTest,
      {},
      admin,
    );
    expect(test.kind).toBe("sent");
    expect(ctx.telegram.hitsOn(`/bot${TELEGRAM_TOKEN}/sendMessage`)).toHaveLength(2);
  });

  test("send-test without a chat id fails with telegram_chat_missing", async () => {
    const failure = await ctx.stack.http.writeErr(ContactHandlers.sendTest, {}, admin);
    expect(failure.httpStatus).toBe(422);
    expect(failure.details).toMatchObject({ reason: "telegram_chat_missing" });
  });

  test("send-test fails with telegram_test_failed when the provider refuses", async () => {
    await configureTelegram("123456:FAIL500tokenABCDEF_xyz", "-100123");
    const failure = await ctx.stack.http.writeErr(ContactHandlers.sendTest, {}, admin);
    expect(failure.httpStatus).toBe(422);
    expect(failure.details).toMatchObject({ reason: "telegram_test_failed" });
  });

  test("the delivery table lists admin mails, Telegram and the reply, also for a SystemAdmin in another tenant", async () => {
    await configureTelegram(TELEGRAM_TOKEN, "-100123");
    const requestId = await submitAnonymous();
    await ctx.stack.http.writeOk(
      ContactHandlers.reply,
      { requestId, message: "Here you go." },
      admin,
    );

    const roaming = await seedRoamingAdmin(ctx.stack, "roaming@example.com");
    const delivery = await ctx.stack.http.queryOk<{ rows: DeliveryRow[] }>(
      ContactQueries.requestDelivery,
      { id: requestId },
      roaming,
    );
    const summary = delivery.rows.map((r) => [r.channel, r.recipient, r.status]);
    expect(summary).toContainEqual([
      "email",
      "Admin admin1@example.com (SystemAdmin)",
      "delivered",
    ]);
    expect(summary).toContainEqual([
      "email",
      "Admin admin2@example.com (SystemAdmin)",
      "delivered",
    ]);
    expect(summary).toContainEqual(["telegram", "-100123", "delivered"]);
    expect(summary).toContainEqual(["reply-email", "Ada Lovelace", "delivered"]);
    expect(delivery.rows.map((r) => r.channel)).not.toContain("confirmation");
    expect(delivery.rows).toHaveLength(4);
    expect(new Set(delivery.rows.map((r) => r.id)).size).toBe(delivery.rows.length);
  });

  test("an in-app reply note shows as read with the time the reporter opened it", async () => {
    const reporter = await seedReporter(ctx.stack, "rita@example.com");
    await ctx.stack.http.writeOk(
      ContactHandlers.report,
      { kind: "question", subject: "Billing", message: "Where is my invoice?" },
      reporter,
    );
    const [request] = await loadRequests(ctx.stack);
    const requestId = String(request?.["id"]);
    await ctx.stack.http.writeOk(
      ContactHandlers.reply,
      { requestId, message: "Check the billing page." },
      admin,
    );

    const before = await ctx.stack.http.queryOk<{ rows: DeliveryRow[] }>(
      ContactQueries.requestDelivery,
      { id: requestId },
      admin,
    );
    expect(before.rows.find((r) => r.channel === "reply-in-app")?.status).toBe("delivered");

    const inbox = await ctx.stack.http.queryOk<{ rows: { id: number }[] }>(
      InAppQueries.inbox,
      {},
      reporter,
    );
    await ctx.stack.http.writeOk(InAppHandlers.markRead, { id: inbox.rows[0]?.id }, reporter);

    const after = await ctx.stack.http.queryOk<{ rows: DeliveryRow[] }>(
      ContactQueries.requestDelivery,
      { id: requestId },
      admin,
    );
    const note = after.rows.find((r) => r.channel === "reply-in-app");
    expect(note?.status).toBe("read");
    expect(note?.recipient).toBe("Rita Reporter");
    expect(note?.at).not.toBe(before.rows.find((r) => r.channel === "reply-in-app")?.at);
  });

  test("replies lists only the answers, oldest first", async () => {
    const requestId = await submitAnonymous();
    for (const message of ["First answer.", "Second answer."]) {
      await ctx.stack.http.writeOk(ContactHandlers.reply, { requestId, message }, admin);
    }
    const replies = await ctx.stack.http.queryOk<{
      rows: { id: string; sentAt: string; authorName: string; message: string }[];
      nextCursor: null;
    }>(ContactQueries.replies, { id: requestId }, admin);
    expect(replies.rows.map((r) => r.message)).toEqual(["First answer.", "Second answer."]);
    expect(replies.rows[0]?.authorName).toBe("Admin admin1@example.com");
    expect(Object.keys(replies.rows[0] ?? {}).sort()).toEqual([
      "authorName",
      "id",
      "message",
      "sentAt",
    ]);
  });

  test("request-detail adds reply-to, reply channels, version label and origin", async () => {
    const requestId = await submitAnonymous();
    const open = await ctx.stack.http.queryOk<{
      replyTo: string;
      replyChannels: string;
      versionLabel: string | null;
      origin: string;
    }>(ContactQueries.requestDetail, { id: requestId }, secondAdmin);
    expect(open.replyTo).toBe("admin2@example.com");
    expect(open.replyChannels).toBe("email");
    expect(open.versionLabel).toBeNull();
    expect(open.origin).toBe("website");

    await setConfig(ContactConfigKeys.replyTo, "support@acme.example");
    const reporter = await seedReporter(ctx.stack, "rita@example.com");
    await ctx.stack.http.writeOk(
      ContactHandlers.report,
      { kind: "bug", subject: "Export", message: "Broken." },
      reporter,
    );
    const reported = (await loadRequests(ctx.stack)).find((r) => r["source"] === "admin");
    const detail = await ctx.stack.http.queryOk<{
      replyTo: string;
      replyChannels: string;
      origin: string;
    }>(ContactQueries.requestDetail, { id: String(reported?.["id"]) }, admin);
    expect(detail.replyTo).toBe("support@acme.example");
    expect(detail.replyChannels).toBe("email+inApp");
    expect(detail.origin).toBe("admin-report");
  });

  test("attempts-by-keys returns channel and status per idempotency key, never an address", async () => {
    const requestId = await submitAnonymous();
    const result = await ctx.stack.http.queryOk<{
      rows: { key: string; channel: string; status: string; recipientId: string | null }[];
    }>(
      DeliveryQueries.attemptsByKeys,
      {
        keys: [
          contactIdempotencyKeys.admins(requestId),
          contactIdempotencyKeys.confirmation(requestId),
        ],
      },
      admin,
    );
    const adminRows = result.rows.filter((r) => r.key === contactIdempotencyKeys.admins(requestId));
    expect(adminRows).toHaveLength(2);
    expect(adminRows.filter((r) => r.channel === "inApp")).toEqual([]);
    expect(JSON.stringify(result)).not.toContain("@example.com");
    const stranger = await ctx.stack.http.queryErr(
      DeliveryQueries.attemptsByKeys,
      { keys: ["x"] },
      await seedReporter(ctx.stack, "other@example.com"),
    );
    expect(stranger.httpStatus).toBe(403);
  });
});

describe("contact mark-done and client", () => {
  test("mark-done closes requests and the open count drops", async () => {
    const first = await submitAnonymous("one@example.com");
    await submitAnonymous("two@example.com");
    await ctx.stack.http.writeOk(ContactHandlers.markDone, { id: first }, admin);
    const count = await ctx.stack.http.queryOk<{ count: number }>(
      ContactQueries.openCount,
      {},
      admin,
    );
    expect(count.count).toBe(1);
  });

  test("the dashboard tile counts open requests through the list query with the tile's own params", async () => {
    const first = await submitAnonymous("one@example.com");
    await submitAnonymous("two@example.com");
    await ctx.stack.http.writeOk(ContactHandlers.markDone, { id: first }, admin);
    const tile = await ctx.stack.http.queryOk<{ total: number }>(
      ContactQueries.requestList,
      contactOpenRequestsPanels()[0]?.params ?? {},
      admin,
    );
    expect(tile.total).toBe(1);
  });

  test("the browser client is served without login and is a single script", async () => {
    const res = await ctx.stack.http.raw("GET", CONTACT_CLIENT_PATH);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/javascript");
    expect(await res.text()).toContain("KumikoContact");
  });
});

describe("contact GDPR and retention", () => {
  async function requestUserDeletion(userId: string): Promise<void> {
    const row = await fetchOne(ctx.stack.db, userTable, { id: userId });
    if (!row) throw new Error("user missing");
    const result = await userExecutor.update(
      {
        id: userId,
        version: Number(row["version"]),
        changes: {
          status: USER_STATUS.DeletionRequested,
          gracePeriodEnd: Temporal.Now.instant().subtract({ minutes: 1 }),
        },
      },
      TestUsers.systemAdmin,
      createTenantDb({
        db: ctx.stack.db,
        tenantId: SYSTEM_TENANT_ID,
        mode: "system",
        reason: "test reads system-tenant contact rows",
      }),
    );
    expect(result.isSuccess).toBe(true);
  }

  test("export lists the user's requests with replies; forget erases requests and replies", async () => {
    const reporter = await seedReporter(ctx.stack, "gdpr@example.com");
    await ctx.stack.http.writeOk(
      ContactHandlers.report,
      { kind: "question", subject: "Data", message: "What do you store?" },
      reporter,
    );
    const [request] = await loadRequests(ctx.stack);
    await ctx.stack.http.writeOk(
      ContactHandlers.reply,
      { requestId: String(request?.["id"]), message: "Very little." },
      admin,
    );

    const bundle = await runUserExport({
      db: ctx.stack.db,
      registry: ctx.stack.registry,
      userId: reporter.id,
      now: Temporal.Now.instant(),
    });
    const snippet = bundle.tenants
      .flatMap((section) => section.entities)
      .find((entity) => entity.entity === "contact-request");
    expect(snippet?.rows).toHaveLength(1);
    expect(JSON.stringify(snippet?.rows[0])).toContain("Very little.");

    await requestUserDeletion(reporter.id);
    const result = await runForgetCleanup({
      db: ctx.stack.db,
      registry: ctx.stack.registry,
      now: Temporal.Now.instant(),
    });
    expect(result.errors).toHaveLength(0);
    expect(await loadRequests(ctx.stack)).toHaveLength(0);
    expect(await loadReplies(ctx.stack)).toHaveLength(0);
  });

  test("with KMS active the stored request carries no plaintext message", async () => {
    configurePiiSubjectKms(new InMemoryKmsAdapter());
    configureBlindIndexKey(Buffer.alloc(32, 7).toString("base64"));
    try {
      const res = await postSubmit(
        ctx.stack,
        await submitBody(ctx.stack, { email: "kms@example.com" }),
      );
      expect(res.status).toBe(200);
      const [stored] = await loadRequests(ctx.stack);
      expect(JSON.stringify(stored)).not.toContain("How do I export my data?");
      expect(JSON.stringify(stored)).not.toContain("kms@example.com");
    } finally {
      resetPiiSubjectKmsForTests();
    }
  });

  test("the retention sweep of the system tenant removes requests past keepFor", async () => {
    await submitAnonymous();
    const result = await runRetentionCleanup({
      db: ctx.stack.db,
      registry: ctx.stack.registry,
      tenantId: SYSTEM_TENANT_ID,
      preloadedTenantPreset: null,
      now: Temporal.Now.instant().add({ hours: 24 * 400 }),
    });
    expect(result.hardDeleted).toBeGreaterThanOrEqual(1);
    expect(await loadRequests(ctx.stack)).toHaveLength(0);
  });
});
