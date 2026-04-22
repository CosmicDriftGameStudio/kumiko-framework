import type { DbConnection } from "@kumiko/framework/db";
import { buildDrizzleTable, createEventStoreExecutor } from "@kumiko/framework/db";
import {
  createEntity,
  createTextField,
  defineFeature,
  defineWriteHandler,
  type NotifyFn,
  qn,
} from "@kumiko/framework/engine";
import {
  createTestUser,
  pushTables,
  setupTestStack,
  type TestStack,
  TestUsers,
} from "@kumiko/framework/testing";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { z } from "zod";
import { createChannelEmailFeature } from "../../channel-email/channel-email-feature";
import { createInMemoryTransport, type EmailMessage } from "../../channel-email/types";
import { createChannelInAppFeature } from "../../channel-in-app/channel-in-app-feature";
import { InAppHandlers, InAppQueries } from "../../channel-in-app/constants";
import { inAppMessagesTable } from "../../channel-in-app/tables";
import { createChannelPushFeature } from "../../channel-push/channel-push-feature";
import { createInMemoryPushTransport } from "../../channel-push/types";
import { createConfigFeature } from "../../config/config-feature";
import { configValuesTable } from "../../config/table";
import { createRendererSimpleFeature } from "../../renderer-simple/renderer-simple-feature";
import { simpleRenderer } from "../../renderer-simple/simple-renderer";
import { TenantQueries } from "../../tenant/constants";
import { tenantMembershipsTable } from "../../tenant/membership-table";
import { tenantEntity } from "../../tenant/tenant-entity";
import { createTenantFeature } from "../../tenant/tenant-feature";
import { DeliveryHandlers, DeliveryQueries } from "../constants";
import { createDeliveryFeature } from "../delivery-feature";
import { collectChannels, createDeliveryService } from "../delivery-service";
import { deliveryLogTable, notificationPreferencesTable } from "../tables";
import { createDeliveryTestContext } from "../testing";
import type { DeliveryService } from "../types";
import { createUnsubscribeRoute, signUnsubscribeToken } from "../unsubscribe";

// --- Setup ---

let stack: TestStack;
let db: DbConnection;
let deliveryService: DeliveryService;
const JWT_SECRET = "test-stack-secret-minimum-32-characters!!";

// Email test infrastructure
const emailTransport = createInMemoryTransport();
const testEmail = (userId: string | number) => `user-${userId}@test.com`;

// Push test infrastructure
const pushTransport = createInMemoryPushTransport();
const testPushToken = (userId: string | number) => `push-token-${userId}`;
const resolveTestEmail = async (userId: string) => testEmail(userId);

const admin = TestUsers.admin;
const user1 = createTestUser({ id: 2, roles: ["User"] });
const user2 = createTestUser({ id: 3, roles: ["User"] });

// Delivery service builds the rate-limit key as `{prefix}:{tenantId}:{channel}`
// — tests set / clear the key directly, so they need the real UUID value.
const RATE_KEY_EMAIL = `test:delivery:rate:${admin.tenantId}:email`;

// App feature that uses ctx.notify() in a handler
const appFeature = defineFeature("app", (r) => {
  r.requires("delivery");

  r.writeHandler(
    defineWriteHandler({
      name: "assignOrder",
      schema: z.object({
        orderId: z.number(),
        driverId: z.string(),
      }),
      handler: async (event, ctx) => {
        const notify = ctx.notify as NotifyFn;
        await notify(qn("app", "notify", "order-assigned"), {
          to: event.payload.driverId,
          data: {
            title: "Neuer Auftrag",
            body: `Auftrag #${event.payload.orderId} wurde dir zugewiesen`,
            orderId: event.payload.orderId,
          },
        });

        return { isSuccess: true, data: { assigned: true } };
      },
      access: { openToAll: true },
    }),
  );

  r.writeHandler(
    defineWriteHandler({
      name: "broadcast",
      schema: z.object({
        message: z.string(),
        userIds: z.array(z.string()),
      }),
      handler: async (event, ctx) => {
        const notify = ctx.notify as NotifyFn;
        await notify(qn("app", "notify", "announcement"), {
          to: event.payload.userIds,
          data: {
            title: "Ankuendigung",
            body: event.payload.message,
          },
        });

        return { isSuccess: true, data: { sent: true } };
      },
      access: { openToAll: true },
    }),
  );

  // Generic notify handler that lets tests pick any notificationType from
  // the request payload. Used by the wildcard-conflict test below so it can
  // exercise the full HTTP→dispatcher→notify path instead of poking the
  // deliveryService directly.
  r.writeHandler(
    defineWriteHandler({
      name: "sendNotification",
      schema: z.object({
        notificationType: z.string(),
        toUserId: z.string(),
        title: z.string(),
        body: z.string(),
      }),
      access: { openToAll: true },
      handler: async (event, ctx) => {
        const notify = ctx.notify as NotifyFn;
        await notify(event.payload.notificationType, {
          to: event.payload.toUserId,
          data: { title: event.payload.title, body: event.payload.body },
        });
        return { isSuccess: true, data: { sent: true } };
      },
    }),
  );

  // Tenant broadcast handler
  r.writeHandler(
    defineWriteHandler({
      name: "tenantAlert",
      schema: z.object({
        message: z.string(),
        tenantId: z.string(),
      }),
      handler: async (event, ctx) => {
        const notify = ctx.notify as NotifyFn;
        await notify(qn("app", "notify", "tenant-alert"), {
          to: { tenant: event.payload.tenantId },
          data: {
            title: "Tenant-Warnung",
            body: event.payload.message,
          },
        });

        return { isSuccess: true, data: { sent: true } };
      },
      access: { openToAll: true },
    }),
  );
});

// Feature with CRUD entity + declarative r.notification()
const ticketEntity = createEntity({
  fields: {
    title: createTextField({ required: true }),
    assigneeId: createTextField(),
    status: createTextField({ required: true }),
  },
});
const ticketTable = buildDrizzleTable("ticket", ticketEntity);

function ticketExecutor() {
  return createEventStoreExecutor(ticketTable, ticketEntity, { entityName: "ticket" });
}

const ticketFeature = defineFeature("tickets", (r) => {
  r.requires("delivery");

  r.entity("ticket", ticketEntity);

  // Real CRUD handler with CrudExecutor (not stub)
  const createHandler = r.writeHandler(
    "ticket:create",
    z.object({
      title: z.string(),
      assigneeId: z.uuid().optional(),
      status: z.string(),
    }),
    async (event, ctx) => ticketExecutor().create(event.payload, event.user, ctx.db),
    { access: { openToAll: true } },
  );

  // Declarative: notify assignee when ticket is created with assigneeId
  // Uses handler ref + per-channel templates
  r.notification("ticketAssigned", {
    trigger: { on: createHandler },
    recipient: (result) => {
      const assigneeId = result.data["assigneeId"] as string | undefined;
      return assigneeId ?? null;
    },
    data: (result) => ({
      title: "Neues Ticket",
      body: `Ticket "${result.data["title"]}" wurde dir zugewiesen`,
      ticketId: result.id,
    }),
    templates: {
      inApp: (data) => ({
        title: data["title"],
        body: data["body"],
      }),
      email: (data) => ({
        subject: `Ticket #${data["ticketId"]} zugewiesen`,
        header: data["title"] as string,
        sections: [
          { text: data["body"] as string },
          { button: { label: "Ticket oeffnen", url: `/tickets/${data["ticketId"]}` } },
        ],
        footer: "Kumiko Notifications",
      }),
    },
  });

  // Second notification on same trigger — tests multiple notifications per handler
  r.notification("ticketCreatedAdmin", {
    trigger: { on: createHandler },
    recipient: () => admin.id, // always notify admin
    data: (result) => ({
      title: "Ticket erstellt",
      body: `Neues Ticket: ${result.data["title"]}`,
      ticketId: result.id,
    }),
  });
});

const configFeature = createConfigFeature();
const tenantFeature = createTenantFeature();
const deliveryFeature = createDeliveryFeature();
const channelInAppFeature = createChannelInAppFeature();
const rendererSimpleFeature = createRendererSimpleFeature();
const channelEmailFeature = createChannelEmailFeature({
  transport: emailTransport,
  renderer: simpleRenderer,
  resolveEmail: resolveTestEmail,
});
const channelPushFeature = createChannelPushFeature({
  transport: pushTransport,
  resolveToken: async (userId) => testPushToken(userId),
});
const features = [
  configFeature,
  tenantFeature,
  deliveryFeature,
  channelInAppFeature,
  rendererSimpleFeature,
  channelEmailFeature,
  channelPushFeature,
  appFeature,
  ticketFeature,
] as const;

beforeAll(async () => {
  stack = await setupTestStack({
    features,
    extraContext: (deps) => {
      const ctx = createDeliveryTestContext(deps, {
        tenantUserIdsQuery: TenantQueries.resolveUserIds,
        rateLimit: { redis: deps.redis, maxPerHour: 100, keyPrefix: "test:delivery:rate" },
        isChannelKilled: async (tenantId, channelName) => {
          const key = `test:delivery:kill:${tenantId}:${channelName}`;
          return (await deps.redis.get(key)) === "1";
        },
      });
      deliveryService = ctx.deliveryService;
      return ctx;
    },
  });
  db = stack.db.db;

  // Mount unsubscribe route BEFORE any requests (Hono router locks after first match)
  stack.app.route("/delivery", createUnsubscribeRoute({ db, jwtSecret: JWT_SECRET }));

  await pushTables(db, {
    configValuesTable,
    tenantMembershipsTable,
    deliveryLogTable,
    inAppMessagesTable,
    notificationPreferencesTable,
    ticketTable,
  });

  // Create tenant entity table + seed memberships for tenant broadcast tests
  const { createEntityTable } = await import("@kumiko/framework/testing");
  await createEntityTable(db, tenantEntity, "tenant");

  // Create tenant + members via real API
  await stack.http.writeOk(
    "tenant:write:create",
    { key: "test", name: "Test Tenant" },
    TestUsers.systemAdmin,
  );
  for (const user of [admin, user1, user2]) {
    await stack.http.writeOk(
      "tenant:write:add-member",
      { userId: user.id, tenantId: "00000000-0000-4000-8000-000000000001", roles: ["User"] },
      TestUsers.systemAdmin,
    );
  }
});

afterAll(async () => {
  await stack.cleanup();
});

// Reset transient state between tests (DB state persists intentionally —
// tests filter explicitly. Transports + SSE events get cleared.)
beforeEach(() => {
  stack.events.reset();
  emailTransport.sent.length = 0;
  pushTransport.sent.length = 0;
});

// --- Flow 1: Handler → ctx.notify() → InApp in DB + SSE + DeliveryLog ---

describe("flow 1: handler sends notification via ctx.notify()", () => {
  test("notification creates InApp message + SSE event + DeliveryLog entries", async () => {
    const result = await stack.http.writeOk(
      "app:write:assign-order",
      { orderId: 42, driverId: user1.id },
      admin,
    );
    expect(result).toEqual({ assigned: true });

    // InApp message in DB
    const messages = await db
      .select()
      .from(inAppMessagesTable)
      .where(eq(inAppMessagesTable.userId, user1.id));
    expect(messages).toHaveLength(1);
    expect(messages[0]?.["title"]).toBe("Neuer Auftrag");
    expect(messages[0]?.["body"]).toBe("Auftrag #42 wurde dir zugewiesen");
    expect(messages[0]?.["isRead"]).toBe(false);

    // SSE event fired
    const sseEvents = stack.events.sse.filter((e) => e.type === "channel-in-app:event:delivered");
    expect(sseEvents).toHaveLength(1);
    expect(sseEvents[0]?.data["userId"]).toBe(user1.id);

    // DeliveryLog entries for all 3 channels
    const logs = await db
      .select()
      .from(deliveryLogTable)
      .where(eq(deliveryLogTable.notificationType, "app:notify:order-assigned"));
    expect(logs).toHaveLength(3);
    const channels = logs.map((l) => l["channel"]);
    expect(channels).toContain("inApp");
    expect(channels).toContain("email");
    expect(channels).toContain("push");
    expect(logs.every((l) => l["status"] === "sent")).toBe(true);
  });
});

// --- Flow 2: Inbox lifecycle — query, markRead, unreadCount ---

describe("flow 2: inbox lifecycle", () => {
  test("inbox returns user's messages", async () => {
    const result = await stack.http.queryOk<{ rows: Record<string, unknown>[] }>(
      InAppQueries.inbox,
      {},
      user1,
    );

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.["title"]).toBe("Neuer Auftrag");
    expect(result.rows[0]?.["isRead"]).toBe(false);
  });

  test("unreadCount reflects unread messages", async () => {
    const result = await stack.http.queryOk<{ count: number }>(InAppQueries.unreadCount, {}, user1);
    expect(result.count).toBe(1);
  });

  test("markRead marks single message as read", async () => {
    const inbox = await stack.http.queryOk<{ rows: Record<string, unknown>[] }>(
      InAppQueries.inbox,
      {},
      user1,
    );
    const messageId = inbox.rows[0]?.["id"] as number;

    await stack.http.writeOk(InAppHandlers.markRead, { id: messageId }, user1);

    const updated = await stack.http.queryOk<{ rows: Record<string, unknown>[] }>(
      InAppQueries.inbox,
      {},
      user1,
    );
    expect(updated.rows[0]?.["isRead"]).toBe(true);
    expect(updated.rows[0]?.["readAt"]).toBeDefined();
  });

  test("unreadCount is 0 after marking read", async () => {
    const result = await stack.http.queryOk<{ count: number }>(InAppQueries.unreadCount, {}, user1);
    expect(result.count).toBe(0);
  });

  test("other user sees empty inbox", async () => {
    const result = await stack.http.queryOk<{ rows: Record<string, unknown>[] }>(
      InAppQueries.inbox,
      {},
      user2,
    );
    expect(result.rows).toHaveLength(0);
  });

  test("markRead on other user's message returns not_found", async () => {
    const inbox = await stack.http.queryOk<{ rows: Record<string, unknown>[] }>(
      InAppQueries.inbox,
      {},
      user1,
    );
    const messageId = inbox.rows[0]?.["id"] as number;

    const error = await stack.http.writeErr(InAppHandlers.markRead, { id: messageId }, user2);
    expect(error.code).toBe("not_found");
  });
});

// --- Flow 3: Broadcast + markAllRead ---

describe("flow 3: broadcast to multiple users + markAllRead", () => {
  test("broadcast creates messages and fires SSE events for all recipients", async () => {
    await stack.http.writeOk(
      "app:write:broadcast",
      { message: "Wartung heute Nacht", userIds: [user1.id, user2.id] },
      admin,
    );

    // Both users have messages in DB
    for (const user of [user1, user2]) {
      const messages = await db
        .select()
        .from(inAppMessagesTable)
        .where(
          and(
            eq(inAppMessagesTable.userId, user.id),
            eq(inAppMessagesTable.notificationType, "app:notify:announcement"),
          ),
        );
      expect(messages).toHaveLength(1);
    }

    // SSE events fired for both users
    const sseEvents = stack.events.sse.filter((e) => e.type === "channel-in-app:event:delivered");
    expect(sseEvents).toHaveLength(2);
    const userIds = sseEvents.map((e) => e.data["userId"]);
    expect(userIds).toContain(user1.id);
    expect(userIds).toContain(user2.id);
  });

  test("delivery log has entries for all recipients and channels", async () => {
    const logs = await db
      .select()
      .from(deliveryLogTable)
      .where(eq(deliveryLogTable.notificationType, "app:notify:announcement"));

    // 2 users × 3 channels (inApp + email + push) = 6 entries
    expect(logs).toHaveLength(6);
    expect(logs.every((l) => l["status"] === "sent")).toBe(true);
  });

  test("markAllRead marks all unread messages", async () => {
    const beforeCount = await stack.http.queryOk<{ count: number }>(
      InAppQueries.unreadCount,
      {},
      user1,
    );
    expect(beforeCount.count).toBe(1); // only announcement is unread

    const result = await stack.http.writeOk<{ marked: number }>(
      InAppHandlers.markAllRead,
      {},
      user1,
    );
    expect(result.marked).toBe(1);

    const afterCount = await stack.http.queryOk<{ count: number }>(
      InAppQueries.unreadCount,
      {},
      user1,
    );
    expect(afterCount.count).toBe(0);
  });

  test("delivery log query returns all entries (admin only)", async () => {
    const result = await stack.http.queryOk<{ rows: Record<string, unknown>[] }>(
      "delivery:query:log",
      { limit: 100 },
      admin,
    );

    // 1 orderAssigned × 3 channels + 2 announcement × 3 channels = 9 total
    expect(result.rows.length).toBe(9);
    expect(result.rows[0]?.["notificationType"]).toBe("app:notify:announcement");
  });
});

// --- Flow 4: Declarative r.notification() — auto fires on CRUD handler ---

describe("flow 4: declarative notification via r.notification()", () => {
  test("CRUD create triggers both notifications with SSE events", async () => {
    await stack.http.writeOk(
      "tickets:write:ticket:create",
      { title: "Server down", assigneeId: user1.id, status: "open" },
      admin,
    );

    // user1 gets ticketAssigned, admin gets ticketCreatedAdmin
    const user1Messages = await db
      .select()
      .from(inAppMessagesTable)
      .where(
        and(
          eq(inAppMessagesTable.userId, user1.id),
          eq(inAppMessagesTable.notificationType, "tickets:notify:ticket-assigned"),
        ),
      );
    expect(user1Messages).toHaveLength(1);
    expect(user1Messages[0]?.["title"]).toBe("Neues Ticket");
    expect(user1Messages[0]?.["body"]).toContain("Server down");

    const adminMessages = await db
      .select()
      .from(inAppMessagesTable)
      .where(
        and(
          eq(inAppMessagesTable.userId, admin.id),
          eq(inAppMessagesTable.notificationType, "tickets:notify:ticket-created-admin"),
        ),
      );
    expect(adminMessages).toHaveLength(1);
    expect(adminMessages[0]?.["title"]).toBe("Ticket erstellt");

    // SSE events for both recipients
    const sseEvents = stack.events.sse.filter((e) => e.type === "channel-in-app:event:delivered");
    expect(sseEvents).toHaveLength(2);
    const userIds = sseEvents.map((e) => e.data["userId"]);
    expect(userIds).toContain(user1.id);
    expect(userIds).toContain(admin.id);
  });

  test("delivery log entries for both notifications", async () => {
    const logs = await db
      .select()
      .from(deliveryLogTable)
      .where(
        and(
          eq(deliveryLogTable.channel, "inApp"),
          eq(deliveryLogTable.recipientId, user1.id),
          eq(deliveryLogTable.notificationType, "tickets:notify:ticket-assigned"),
        ),
      );
    expect(logs).toHaveLength(1);
    expect(logs[0]?.["status"]).toBe("sent");
  });
});

// --- Flow 5: recipient returns null → notification skipped ---

describe("flow 5: notification skipped when recipient is null", () => {
  test("ticket without assigneeId skips ticketAssigned but still sends ticketCreatedAdmin", async () => {
    stack.events.reset();

    await stack.http.writeOk(
      "tickets:write:ticket:create",
      { title: "Docs update", status: "open" },
      admin,
    );

    // No ticketAssigned notification (no assignee)
    const assigneeNotifs = await db
      .select()
      .from(inAppMessagesTable)
      .where(eq(inAppMessagesTable.notificationType, "tickets:notify:ticket-assigned"));
    // Only the one from flow 4 should exist
    expect(assigneeNotifs).toHaveLength(1);

    // But admin still gets ticketCreatedAdmin
    const adminMessages = await db
      .select()
      .from(inAppMessagesTable)
      .where(eq(inAppMessagesTable.notificationType, "tickets:notify:ticket-created-admin"));
    expect(adminMessages).toHaveLength(2); // flow 4 + flow 5

    // SSE: only 1 event (admin only, no assignee)
    const notifs = stack.events.sse.filter((e) => e.type === "channel-in-app:event:delivered");
    expect(notifs).toHaveLength(1);
    expect(notifs[0]?.data["userId"]).toBe(admin.id);
  });
});

// --- Flow 6: User Preferences — disable channel, notification skipped ---

describe("flow 6: user preferences", () => {
  test("setPreference disables inApp for a notification type", async () => {
    await stack.http.writeOk(
      DeliveryHandlers.setPreference,
      { notificationType: "app:notify:order-assigned", channel: "inApp", enabled: false },
      user1,
    );

    // Verify preference is stored
    const prefs = await stack.http.queryOk<{ rows: Record<string, unknown>[] }>(
      DeliveryQueries.preferences,
      {},
      user1,
    );
    expect(prefs.rows).toHaveLength(1);
    expect(prefs.rows[0]?.["notificationType"]).toBe("app:notify:order-assigned");
    expect(prefs.rows[0]?.["channel"]).toBe("inApp");
    expect(prefs.rows[0]?.["enabled"]).toBe(false);
  });

  test("notification is skipped when channel is disabled by preference", async () => {
    stack.events.reset();

    // Count messages before
    const before = await db
      .select()
      .from(inAppMessagesTable)
      .where(eq(inAppMessagesTable.userId, user1.id));
    const beforeCount = before.length;

    // Send notification to user1 who has disabled inApp for orderAssigned
    await stack.http.writeOk("app:write:assign-order", { orderId: 99, driverId: user1.id }, admin);

    // No new InApp message for user1
    const after = await db
      .select()
      .from(inAppMessagesTable)
      .where(eq(inAppMessagesTable.userId, user1.id));
    expect(after.length).toBe(beforeCount);

    // No SSE event
    const notifs = stack.events.sse.filter((e) => e.type === "channel-in-app:event:delivered");
    expect(notifs).toHaveLength(0);

    // DeliveryLog shows skipped with preference_disabled
    const logs = await db
      .select()
      .from(deliveryLogTable)
      .where(
        and(
          eq(deliveryLogTable.notificationType, "app:notify:order-assigned"),
          eq(deliveryLogTable.recipientId, user1.id),
          eq(deliveryLogTable.status, "skipped"),
          eq(deliveryLogTable.error, "preference_disabled"),
        ),
      );
    expect(logs.length).toBeGreaterThanOrEqual(1);
  });

  test("critical priority ignores preferences", async () => {
    stack.events.reset();

    // user1 still has inApp disabled for orderAssigned
    // But a critical notification should go through
    await deliveryService.notify(
      "app:notify:order-assigned",
      {
        to: user1.id,
        data: { title: "CRITICAL: Order storniert", body: "Sofort reagieren" },
        priority: "critical",
      },
      admin,
      admin.tenantId,
    );

    // Should have created a message despite disabled preference
    const notifs = stack.events.sse.filter((e) => e.type === "channel-in-app:event:delivered");
    expect(notifs).toHaveLength(1);
    expect(notifs[0]?.data["title"]).toBe("CRITICAL: Order storniert");
  });

  test("re-enable preference restores delivery", async () => {
    stack.events.reset();

    // Re-enable
    await stack.http.writeOk(
      DeliveryHandlers.setPreference,
      { notificationType: "app:notify:order-assigned", channel: "inApp", enabled: true },
      user1,
    );

    // Send notification again
    await stack.http.writeOk("app:write:assign-order", { orderId: 100, driverId: user1.id }, admin);

    // Should work again
    const notifs = stack.events.sse.filter((e) => e.type === "channel-in-app:event:delivered");
    expect(notifs).toHaveLength(1);
    expect(notifs[0]?.data["userId"]).toBe(user1.id);
  });

  test("exact preference overrides wildcard", async () => {
    stack.events.reset();

    // Disable ALL inApp notifications via wildcard
    await stack.http.writeOk(
      DeliveryHandlers.setPreference,
      { notificationType: "*", channel: "inApp", enabled: false },
      user1,
    );

    // user1 still has { orderAssigned, inApp, enabled: true } from re-enable test
    // Send notification — exact match (enabled: true) should win over wildcard (enabled: false)
    await stack.http.writeOk("app:write:assign-order", { orderId: 200, driverId: user1.id }, admin);

    const notifs = stack.events.sse.filter((e) => e.type === "channel-in-app:event:delivered");
    expect(notifs).toHaveLength(1);
    expect(notifs[0]?.data["userId"]).toBe(user1.id);

    // Clean up wildcard preference
    await stack.http.writeOk(
      DeliveryHandlers.setPreference,
      { notificationType: "*", channel: "inApp", enabled: true },
      user1,
    );
  });
});

// --- Flow 7: Unsubscribe endpoint ---

describe("flow 7: unsubscribe endpoint", () => {
  test("signed unsubscribe token disables preference", async () => {
    const token = await signUnsubscribeToken(
      {
        userId: user2.id,
        tenantId: user2.tenantId,
        notificationType: "app:notify:announcement",
        channel: "inApp",
      },
      JWT_SECRET,
    );

    const res = await stack.app.request(`/delivery/unsubscribe?token=${token}`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("unsubscribed");

    // Verify preference was created
    const prefs = await stack.http.queryOk<{ rows: Record<string, unknown>[] }>(
      DeliveryQueries.preferences,
      {},
      user2,
    );
    const pref = prefs.rows.find(
      (r) => r["notificationType"] === "app:notify:announcement" && r["channel"] === "inApp",
    );
    expect(pref).toBeDefined();
    expect(pref?.["enabled"]).toBe(false);
  });

  test("invalid token returns 400", async () => {
    const res = await stack.app.request("/delivery/unsubscribe?token=invalid-jwt-token");
    expect(res.status).toBe(400);
  });

  test("missing token returns 400", async () => {
    const res = await stack.app.request("/delivery/unsubscribe");
    expect(res.status).toBe(400);
  });
});

// --- Flow 9: Email Channel + Renderer end-to-end ---

describe("flow 9: email channel with renderer", () => {
  test("declarative notification fires on all channels with rendered email", async () => {
    // Create ticket with assignee — triggers ticketAssigned notification
    await stack.http.writeOk(
      "tickets:write:ticket:create",
      { title: "Login kaputt", assigneeId: user1.id, status: "open" },
      admin,
    );

    // Email sent via transport with rendered HTML
    const emails = emailTransport.sent.filter((e) => e.to === testEmail(user1.id));
    expect(emails).toHaveLength(1);
    const email = emails[0] as EmailMessage;
    expect(email.subject).toMatch(/Ticket #[0-9a-f-]+ zugewiesen/);
    expect(email.html).toContain("Neues Ticket");
    expect(email.html).toContain("Login kaputt");
    expect(email.html).toContain("Ticket oeffnen");
    expect(email.html).toContain("/tickets/");
    expect(email.html).toContain("<!DOCTYPE html>");
    expect(email.html).toContain("</html>");

    // InApp also fired — ticketAssigned for user1 + ticketCreatedAdmin for admin
    const sseEvents = stack.events.sse.filter(
      (e) => e.type === "channel-in-app:event:delivered" && e.data["title"] === "Neues Ticket",
    );
    expect(sseEvents.length).toBeGreaterThanOrEqual(1);
  });

  test("delivery log has entries for both channels", async () => {
    const logs = await db
      .select()
      .from(deliveryLogTable)
      .where(eq(deliveryLogTable.notificationType, "tickets:notify:ticket-assigned"));

    const channels = logs.map((l) => l["channel"]);
    expect(channels).toContain("inApp");
    expect(channels).toContain("email");
  });

  test("notification without email template skips email rendering", async () => {
    emailTransport.sent.length = 0;

    // The manual app.assignOrder handler has no email template
    await stack.http.writeOk("app:write:assign-order", { orderId: 300, driverId: user1.id }, admin);

    // Email still sent (fallback to plain text) since email channel resolves the user
    const emails = emailTransport.sent.filter((e) => e.to === testEmail(user1.id));
    expect(emails).toHaveLength(1);
    // But it uses the simple fallback (title as h1)
    // Renderer always runs — falls back to title/body as header + section
    expect(emails[0]?.html).toContain("<!DOCTYPE html>");
    expect(emails[0]?.html).toContain("<h1"); // title as header
    expect(emails[0]?.html).toContain("Neuer Auftrag");
  });
});

// --- Flow 10: Complete end-to-end path ---
// CRUD → postSave → r.notification() with templates → both channels → DB + SSE + Email + Log

describe("flow 10: complete end-to-end", () => {
  test("single CRUD operation triggers InApp + Email with per-channel templates", async () => {
    stack.events.reset();
    emailTransport.sent.length = 0;

    // Create ticket with assignee — fires ticketAssigned notification
    // which has both inApp and email templates defined
    await stack.http.writeOk(
      "tickets:write:ticket:create",
      { title: "Datenbank Backup fehlgeschlagen", assigneeId: user2.id, status: "critical" },
      admin,
    );

    // --- InApp Channel ---

    // InApp message in DB with template-transformed data
    const inAppMessages = await db
      .select()
      .from(inAppMessagesTable)
      .where(
        and(
          eq(inAppMessagesTable.userId, user2.id),
          eq(inAppMessagesTable.notificationType, "tickets:notify:ticket-assigned"),
        ),
      );
    // Filter to this specific ticket by checking title
    const thisMessage = inAppMessages.find((m) =>
      (m["body"] as string)?.includes("Datenbank Backup"),
    );
    expect(thisMessage).toBeDefined();
    expect(thisMessage?.["title"]).toBe("Neues Ticket");
    expect(thisMessage?.["body"]).toContain("Datenbank Backup fehlgeschlagen");

    // SSE event fired
    const sseNotifs = stack.events.sse.filter(
      (e) =>
        e.type === "channel-in-app:event:delivered" &&
        e.data["userId"] === user2.id &&
        e.data["title"] === "Neues Ticket",
    );
    expect(sseNotifs.length).toBeGreaterThanOrEqual(1);

    // --- Email Channel ---

    // Email sent via transport with rendered HTML
    const emails = emailTransport.sent.filter((e) => e.to === testEmail(user2.id));
    const thisEmail = emails.find((e) => e.html.includes("Datenbank Backup"));
    expect(thisEmail).toBeDefined();
    // Subject from email template
    expect(thisEmail?.subject).toMatch(/Ticket #[0-9a-f-]+ zugewiesen/);
    // HTML from Simple Renderer (has DOCTYPE, header, sections, button, footer)
    expect(thisEmail?.html).toContain("<!DOCTYPE html>");
    expect(thisEmail?.html).toContain("Neues Ticket"); // header
    expect(thisEmail?.html).toContain("Datenbank Backup fehlgeschlagen"); // text section
    expect(thisEmail?.html).toContain("Ticket oeffnen"); // button label
    expect(thisEmail?.html).toContain("/tickets/"); // button URL
    expect(thisEmail?.html).toContain("Kumiko Notifications"); // footer

    // --- DeliveryLog ---

    const logs = await db
      .select()
      .from(deliveryLogTable)
      .where(
        and(
          eq(deliveryLogTable.notificationType, "tickets:notify:ticket-assigned"),
          eq(deliveryLogTable.recipientId, user2.id),
        ),
      );
    // Filter to logs from this test (there may be prior entries)
    const inAppLog = logs.find((l) => l["channel"] === "inApp");
    const emailLog = logs.find((l) => l["channel"] === "email");
    expect(inAppLog).toBeDefined();
    expect(inAppLog?.["status"]).toBe("sent");
    expect(emailLog).toBeDefined();
    expect(emailLog?.["status"]).toBe("sent");
    expect(emailLog?.["recipientAddress"]).toBe(testEmail(user2.id));
  });
});

// --- Flow 8: Tenant broadcast ---

describe("flow 8: tenant broadcast via to: { tenant }", () => {
  test("broadcasts to all users with SSE events", async () => {
    await stack.http.writeOk(
      "app:write:tenant-alert",
      { message: "Server-Wartung um 22:00", tenantId: "00000000-0000-4000-8000-000000000001" },
      admin,
    );

    // All 3 tenant users get a message
    const messages = await db
      .select()
      .from(inAppMessagesTable)
      .where(eq(inAppMessagesTable.notificationType, "app:notify:tenant-alert"));
    const recipientIds = messages.map((m) => m["userId"]);
    expect(recipientIds).toContain(admin.id);
    expect(recipientIds).toContain(user1.id);
    expect(recipientIds).toContain(user2.id);

    // SSE events for all 3 users
    const sseEvents = stack.events.sse.filter(
      (e) =>
        e.type === "channel-in-app:event:delivered" &&
        e.data["notificationType"] === "app:notify:tenant-alert",
    );
    expect(sseEvents).toHaveLength(3);
    const userIds = sseEvents.map((e) => e.data["userId"]);
    expect(userIds).toContain(admin.id);
    expect(userIds).toContain(user1.id);
    expect(userIds).toContain(user2.id);
  });

  test("delivery log has entries for all recipients and channels", async () => {
    const logs = await db
      .select()
      .from(deliveryLogTable)
      .where(eq(deliveryLogTable.notificationType, "app:notify:tenant-alert"));

    // 3 users × 3 channels (inApp + email + push) = 9
    expect(logs).toHaveLength(9);
    expect(logs.every((l) => l["status"] === "sent")).toBe(true);
  });
});

// --- Flow 11: Push channel end-to-end ---

describe("flow 11: push channel", () => {
  test("notification sends push via transport", async () => {
    pushTransport.sent.length = 0;

    await stack.http.writeOk("app:write:assign-order", { orderId: 500, driverId: user1.id }, admin);

    const pushes = pushTransport.sent.filter((p) => p.token === testPushToken(user1.id));
    expect(pushes).toHaveLength(1);
    expect(pushes[0]?.title).toBe("Neuer Auftrag");
  });
});

// --- Flow 12: Rate limiting ---

describe("flow 12: rate limiting", () => {
  test("notifications are skipped after rate limit is reached", async () => {
    // Set a very low rate limit via Redis key manipulation
    // The rate limit key is "test:delivery:rate:{tenantId}:{channel}"
    // Set it to maxPerHour (100) so the next send is over limit
    await stack.redis.redis.set(RATE_KEY_EMAIL, "100");
    await stack.redis.redis.expire(RATE_KEY_EMAIL, 3600);

    stack.events.reset();
    emailTransport.sent.length = 0;

    await stack.http.writeOk("app:write:assign-order", { orderId: 501, driverId: user1.id }, admin);

    // Email should be skipped (rate limited), but inApp + push should work
    const emailLogs = await db
      .select()
      .from(deliveryLogTable)
      .where(
        and(
          eq(deliveryLogTable.notificationType, "app:notify:order-assigned"),
          eq(deliveryLogTable.recipientId, user1.id),
          eq(deliveryLogTable.channel, "email"),
          eq(deliveryLogTable.error, "rate_limited"),
        ),
      );
    expect(emailLogs.length).toBeGreaterThanOrEqual(1);

    // InApp still works
    const sseNotifs = stack.events.sse.filter((e) => e.type === "channel-in-app:event:delivered");
    expect(sseNotifs.length).toBeGreaterThanOrEqual(1);

    // Clean up
    await stack.redis.redis.del(RATE_KEY_EMAIL);
  });
});

// --- Flow 12b: Rate-limit atomicity under concurrent dispatch ---

describe("flow 12b: rate-limit under concurrent load", () => {
  test("exactly maxPerHour deliveries allowed, rest rejected (no counter drift)", async () => {
    // Fresh counter
    await stack.redis.redis.del(RATE_KEY_EMAIL);

    // Fire 250 concurrent notify calls against an email channel with max=100/h.
    // The atomic Lua check must allow exactly 100 through and reject 150.
    const CONCURRENT = 250;
    const MAX = 100;

    emailTransport.sent.length = 0;
    stack.events.reset();

    await Promise.all(
      Array.from({ length: CONCURRENT }, (_, i) =>
        deliveryService.notify(
          "app:notify:rate-race",
          {
            route: { email: `race-${i}@test.com` },
            data: { title: "Race", body: "Test" },
          },
          admin,
          admin.tenantId,
        ),
      ),
    );

    // Exactly MAX emails actually sent. The real proof of atomicity: if the
    // old non-atomic INCR+DECR had a race, we'd see either MORE than MAX
    // (two checks both seeing count <= max and slipping through) or LESS
    // than MAX (DECR rolling back counts that were legitimately used).
    const raceEmails = emailTransport.sent.filter((e) => e.to.startsWith("race-"));
    expect(raceEmails.length).toBe(MAX);

    // Redis counter must sit at exactly MAX — never above (would mean two
    // INCRs slipped past the check), never below (would mean a DECR rolled
    // back a legitimate hit).
    const counter = Number(await stack.redis.redis.get(RATE_KEY_EMAIL));
    expect(counter).toBe(MAX);

    await stack.redis.redis.del(RATE_KEY_EMAIL);
  });
});

// --- Flow 12c: Idempotency key ---

describe("flow 12c: idempotency key dedup", () => {
  test("same idempotencyKey fires only once even when called twice", async () => {
    emailTransport.sent.length = 0;
    stack.events.reset();
    await stack.redis.redis.del(RATE_KEY_EMAIL);

    const idemKey = `idem-${Date.now()}`;

    // First call: should deliver
    await deliveryService.notify(
      "app:notify:idem-test",
      {
        to: user2.id,
        data: { title: "Idem", body: "First" },
        idempotencyKey: idemKey,
      },
      admin,
      admin.tenantId,
    );

    // Second call with same key: should be deduped → no new delivery
    await deliveryService.notify(
      "app:notify:idem-test",
      {
        to: user2.id,
        data: { title: "Idem", body: "Second (ignored)" },
        idempotencyKey: idemKey,
      },
      admin,
      admin.tenantId,
    );

    const emails = emailTransport.sent.filter((e) => e.to === testEmail(user2.id));
    expect(emails.length).toBe(1);

    // Dup attempt is recorded in the log for audit
    const dupLogs = await db
      .select()
      .from(deliveryLogTable)
      .where(
        and(
          eq(deliveryLogTable.notificationType, "app:notify:idem-test"),
          eq(deliveryLogTable.error, "duplicate_idempotency_key"),
        ),
      );
    expect(dupLogs.length).toBe(1);
  });

  test("different idempotencyKey fires separately", async () => {
    emailTransport.sent.length = 0;
    stack.events.reset();
    await stack.redis.redis.del(RATE_KEY_EMAIL);

    const a = `idem-a-${Date.now()}`;
    const b = `idem-b-${Date.now()}`;

    await deliveryService.notify(
      "app:notify:idem-separate",
      { to: user2.id, data: { title: "A", body: "A" }, idempotencyKey: a },
      admin,
      admin.tenantId,
    );
    await deliveryService.notify(
      "app:notify:idem-separate",
      { to: user2.id, data: { title: "B", body: "B" }, idempotencyKey: b },
      admin,
      admin.tenantId,
    );

    const emails = emailTransport.sent.filter((e) => e.to === testEmail(user2.id));
    expect(emails.length).toBe(2);
  });
});

// --- Flow 12d: Channel error paths ---

describe("flow 12d: channel error paths", () => {
  test("transport throws → delivery log status=failed with error message", async () => {
    emailTransport.sent.length = 0;
    stack.events.reset();

    // Arm the transport to fail on the next send
    emailTransport.failNext = { message: "smtp_timeout_simulated" };

    await stack.http.writeOk("app:write:assign-order", { orderId: 700, driverId: user1.id }, admin);

    // Email was attempted but not delivered
    const emails = emailTransport.sent.filter((e) => e.to === testEmail(user1.id));
    expect(emails.length).toBe(0);

    // Log shows the failure with the original error string
    const failedLogs = await db
      .select()
      .from(deliveryLogTable)
      .where(
        and(
          eq(deliveryLogTable.notificationType, "app:notify:order-assigned"),
          eq(deliveryLogTable.recipientId, user1.id),
          eq(deliveryLogTable.channel, "email"),
          eq(deliveryLogTable.status, "failed"),
        ),
      );
    expect(failedLogs.length).toBeGreaterThanOrEqual(1);
    expect(failedLogs.at(-1)?.["error"]).toContain("smtp_timeout_simulated");

    // Other channels still work — one failure does not poison the rest
    const inAppNotifs = stack.events.sse.filter((e) => e.type === "channel-in-app:event:delivered");
    expect(inAppNotifs.some((e) => e.data["userId"] === user1.id)).toBe(true);
  });

  test("transport failure on one recipient does not block others", async () => {
    emailTransport.sent.length = 0;
    stack.events.reset();

    // Fail the NEXT send — which corresponds to the first recipient processed
    emailTransport.failNext = { message: "smtp_transient" };

    await stack.http.writeOk(
      "app:write:broadcast",
      { message: "Partial outage test", userIds: [user1.id, user2.id] },
      admin,
    );

    // Exactly one email succeeded; the other was logged as failed
    const broadcastEmails = emailTransport.sent.filter(
      (e) => e.to === testEmail(user1.id) || e.to === testEmail(user2.id),
    );
    expect(broadcastEmails.length).toBe(1);

    const failedLogs = await db
      .select()
      .from(deliveryLogTable)
      .where(
        and(
          eq(deliveryLogTable.notificationType, "app:notify:announcement"),
          eq(deliveryLogTable.channel, "email"),
          eq(deliveryLogTable.status, "failed"),
          eq(deliveryLogTable.error, "smtp_transient"),
        ),
      );
    expect(failedLogs.length).toBe(1);
  });
});

// --- Flow 13: Kill switch ---

describe("flow 13: tenant kill switch", () => {
  test("killed channel is skipped with channel_disabled", async () => {
    // Kill the push channel for tenant 1 (UUID key matches what the service builds)
    await stack.redis.redis.set(`test:delivery:kill:${admin.tenantId}:push`, "1");

    stack.events.reset();
    pushTransport.sent.length = 0;

    await stack.http.writeOk("app:write:assign-order", { orderId: 502, driverId: user1.id }, admin);

    // Push should be skipped
    const pushes = pushTransport.sent.filter((p) => p.token === testPushToken(user1.id));
    expect(pushes).toHaveLength(0);

    // DeliveryLog shows channel_disabled
    const pushLogs = await db
      .select()
      .from(deliveryLogTable)
      .where(
        and(
          eq(deliveryLogTable.notificationType, "app:notify:order-assigned"),
          eq(deliveryLogTable.recipientId, user1.id),
          eq(deliveryLogTable.channel, "push"),
          eq(deliveryLogTable.error, "channel_disabled"),
        ),
      );
    expect(pushLogs.length).toBeGreaterThanOrEqual(1);

    // InApp + Email still work
    const sseNotifs = stack.events.sse.filter((e) => e.type === "channel-in-app:event:delivered");
    expect(sseNotifs.length).toBeGreaterThanOrEqual(1);

    // Clean up
    await stack.redis.redis.del("test:delivery:kill:1:push");
  });
});

// --- Flow 14: Preference wildcard conflict — deny wins ---

describe("flow 14: wildcard-only preference conflicts resolve deterministically", () => {
  test("conflicting wildcards (type=*, false vs channel=*, true) → disabled wins", async () => {
    // Clean slate for user2 on this type/channel
    await db
      .delete(notificationPreferencesTable)
      .where(eq(notificationPreferencesTable.userId, user2.id));

    // Wildcard A: disable inApp globally
    await stack.http.writeOk(
      DeliveryHandlers.setPreference,
      { notificationType: "*", channel: "inApp", enabled: false },
      user2,
    );
    // Wildcard B: enable this specific type on every channel
    await stack.http.writeOk(
      DeliveryHandlers.setPreference,
      { notificationType: "app:notify:wildcard-conflict", channel: "*", enabled: true },
      user2,
    );

    stack.events.reset();
    await stack.http.writeOk(
      "app:write:send-notification",
      {
        notificationType: "app:notify:wildcard-conflict",
        toUserId: user2.id,
        title: "Konflikt",
        body: "Test",
      },
      admin,
    );

    // No InApp delivery — "disabled wins" over the enabling wildcard
    const inAppEvents = stack.events.sse.filter((e) => e.type === "channel-in-app:event:delivered");
    expect(inAppEvents.filter((e) => e.data["userId"] === user2.id)).toHaveLength(0);

    const skipped = await db
      .select()
      .from(deliveryLogTable)
      .where(
        and(
          eq(deliveryLogTable.notificationType, "app:notify:wildcard-conflict"),
          eq(deliveryLogTable.recipientId, user2.id),
          eq(deliveryLogTable.channel, "inApp"),
          eq(deliveryLogTable.error, "preference_disabled"),
        ),
      );
    expect(skipped.length).toBeGreaterThanOrEqual(1);
  });

  test("exact-match preference still punches through both wildcards", async () => {
    // Keep the two conflicting wildcards from the previous test, add an exact override
    await stack.http.writeOk(
      DeliveryHandlers.setPreference,
      {
        notificationType: "app:notify:wildcard-conflict",
        channel: "inApp",
        enabled: true,
      },
      user2,
    );

    stack.events.reset();
    await stack.http.writeOk(
      "app:write:send-notification",
      {
        notificationType: "app:notify:wildcard-conflict",
        toUserId: user2.id,
        title: "Konflikt",
        body: "Override",
      },
      admin,
    );

    const inAppEvents = stack.events.sse.filter((e) => e.type === "channel-in-app:event:delivered");
    expect(inAppEvents.filter((e) => e.data["userId"] === user2.id)).toHaveLength(1);

    // Clean up for later tests
    await db
      .delete(notificationPreferencesTable)
      .where(eq(notificationPreferencesTable.userId, user2.id));
  });
});

// --- Flow 15: Idempotency without Redis throws (no silent no-op) ---

describe("flow 15: idempotency requires Redis", () => {
  test("notify() throws when idempotencyKey is used without a Redis handle", async () => {
    // Build a service with no rateLimit and no idempotencyRedis.
    // sseBroker is left off — the throw happens before channel dispatch.
    const bareService = createDeliveryService({
      db,
      registry: stack.registry,
      channels: collectChannels(stack.registry),
      tenantUserIdsQuery: TenantQueries.resolveUserIds,
    });

    await expect(
      bareService.notify(
        "app:notify:idem-no-redis",
        {
          to: user2.id,
          data: { title: "X", body: "X" },
          idempotencyKey: "key-without-redis",
        },
        admin,
        admin.tenantId,
      ),
    ).rejects.toThrow(/idempotencyRedis/);
  });
});

// --- Flow 16: Unsubscribe race — ON CONFLICT makes repeated clicks safe ---

describe("flow 16: repeated unsubscribe clicks are idempotent", () => {
  test("clicking the same unsubscribe link twice concurrently does not error", async () => {
    const token = await signUnsubscribeToken(
      {
        userId: user1.id,
        tenantId: user1.tenantId,
        notificationType: "app:notify:concurrent-unsub",
        channel: "email",
      },
      JWT_SECRET,
    );

    const url = `/delivery/unsubscribe?token=${token}`;
    const results = await Promise.all([
      stack.app.request(url),
      stack.app.request(url),
      stack.app.request(url),
    ]);

    // All three requests complete with 200 — no duplicate-key crashes
    for (const res of results) {
      expect(res.status).toBe(200);
    }

    // Exactly one row exists, marked disabled
    const rows = await db
      .select()
      .from(notificationPreferencesTable)
      .where(
        and(
          eq(notificationPreferencesTable.userId, user1.id),
          eq(notificationPreferencesTable.notificationType, "app:notify:concurrent-unsub"),
          eq(notificationPreferencesTable.channel, "email"),
        ),
      );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.["enabled"]).toBe(false);
  });
});
