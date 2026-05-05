// Sample Integration Test: Delivery Notifications
//
// Proves the full declarative notification path end-to-end:
// 1. Admin creates ticket with assignee (via HTTP API)
// 2. r.notification() fires automatically after postSave
// 3. InApp → DB + SSE
// 4. Email → Template → Renderer → Transport
// 5. Push → Transport
// 6. DeliveryLog has entries for all 3 channels

import {
  createChannelEmailFeature,
  createInMemoryTransport,
  type EmailMessage,
} from "@cosmicdrift/kumiko-bundled-features/channel-email";
import {
  createChannelInAppFeature,
  inAppMessagesTable,
} from "@cosmicdrift/kumiko-bundled-features/channel-in-app";
import {
  createChannelPushFeature,
  createInMemoryPushTransport,
  type PushMessage,
} from "@cosmicdrift/kumiko-bundled-features/channel-push";
import { createConfigFeature } from "@cosmicdrift/kumiko-bundled-features/config";
import {
  createDeliveryFeature,
  createDeliveryTestContext,
  deliveryAttemptsTable,
  notificationPreferencesTable,
} from "@cosmicdrift/kumiko-bundled-features/delivery";
import {
  createRendererSimpleFeature,
  simpleRenderer,
} from "@cosmicdrift/kumiko-bundled-features/renderer-simple";
import {
  createTenantFeature,
  TenantQueries,
  tenantMembershipsTable,
} from "@cosmicdrift/kumiko-bundled-features/tenant";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import type { SessionUser } from "@cosmicdrift/kumiko-framework/engine";
import { createEventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  createTestUser,
  pushTables,
  setupTestStack,
  type TestStack,
  TestUsers,
} from "@cosmicdrift/kumiko-framework/stack";
import { expectErrorIncludes } from "@cosmicdrift/kumiko-framework/testing";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { supportFeature, ticketTable } from "../feature";

// --- Test Infrastructure ---

const emailTransport = createInMemoryTransport();
const pushTransport = createInMemoryPushTransport();

// Simple resolvers: userId → address
const testEmail = (userId: number) => `user-${userId}@example.com`;
const testPushToken = (userId: number) => `push-token-${userId}`;

// Test users
const admin: SessionUser = TestUsers.admin;
const assignee = createTestUser({ id: 5, roles: ["Support"] });

// --- Feature Setup ---

const features = [
  createConfigFeature(),
  createTenantFeature(),
  createDeliveryFeature(),
  createChannelInAppFeature(),
  createRendererSimpleFeature(),
  createChannelEmailFeature({
    transport: emailTransport,
    renderer: simpleRenderer,
    resolveEmail: async (userId) => testEmail(userId),
  }),
  createChannelPushFeature({
    transport: pushTransport,
    resolveToken: async (userId) => testPushToken(userId),
  }),
  supportFeature,
];

let stack: TestStack;
let db: DbConnection;

beforeAll(async () => {
  stack = await setupTestStack({
    features,
    extraContext: (deps) =>
      createDeliveryTestContext(deps, { tenantUserIdsQuery: TenantQueries.resolveUserIds }),
  });
  db = stack.db;

  await pushTables(db, {
    inAppMessagesTable,
    notificationPreferencesTable,
    tenantMembershipsTable,
    ticketTable,
  });
  await createEventsTable(db);
});

afterAll(async () => {
  await stack.cleanup();
});

// --- End-to-End Flow ---

describe("delivery-notifications sample", () => {
  test("ticket creation fires InApp + Email + Push notifications to assignee", async () => {
    // Reset transports and SSE
    emailTransport.sent.length = 0;
    pushTransport.sent.length = 0;
    stack.events.reset();

    // --- Act: Admin creates a ticket with an assignee ---
    await stack.http.writeOk(
      "support:write:ticket:create",
      {
        title: "Login-Button reagiert nicht",
        description: "Nach Klick auf Login passiert nichts in Firefox.",
        assigneeId: assignee.id,
        priority: "critical",
        status: "open",
      },
      admin,
    );

    // --- Assert: InApp ---
    const inAppMessages = await db
      .select()
      .from(inAppMessagesTable)
      .where(eq(inAppMessagesTable.userId, assignee.id));
    expect(inAppMessages).toHaveLength(1);
    expect(inAppMessages[0]?.["title"]).toBe("Neues Ticket: Login-Button reagiert nicht");
    expect(inAppMessages[0]?.["body"]).toContain("Nach Klick auf Login");

    const sseEvents = stack.events.sse.filter((e) => e.type === "channel-in-app:event:delivered");
    expect(sseEvents).toHaveLength(1);
    expect(sseEvents[0]?.data["userId"]).toBe(assignee.id);

    // --- Assert: Email ---
    const email = emailTransport.sent.find((e: EmailMessage) => e.to === testEmail(assignee.id));
    expect(email).toBeDefined();
    expect(email?.subject).toContain("Support-Ticket #");
    expect(email?.subject).toContain("critical");
    // HTML from Simple Renderer
    expect(email?.html).toContain("<!DOCTYPE html>");
    expect(email?.html).toContain("Neues Ticket: Login-Button reagiert nicht"); // header
    expect(email?.html).toContain("Nach Klick auf Login"); // text section
    expect(email?.html).toContain("Prioritaet: critical");
    expect(email?.html).toContain("Ticket oeffnen"); // button
    expect(email?.html).toContain("/support/tickets/"); // button URL
    expect(email?.html).toContain("Automatische Benachrichtigung"); // footer

    // --- Assert: Push ---
    const push = pushTransport.sent.find(
      (p: PushMessage) => p.token === testPushToken(assignee.id),
    );
    expect(push).toBeDefined();
    expect(push?.title).toBe("Neues Ticket");
    expect(push?.body).toContain("Login-Button");
    expect(push?.body).toContain("critical");

    // --- Assert: DeliveryLog has entries for all 3 channels ---
    const logs = await db
      .select()
      .from(deliveryAttemptsTable)
      .where(
        and(
          eq(deliveryAttemptsTable.notificationType, "support:notify:ticket-assigned"),
          eq(deliveryAttemptsTable.recipientId, assignee.id),
        ),
      );
    expect(logs).toHaveLength(3);
    const channels = logs.map((l) => l["channel"]);
    expect(channels).toContain("inApp");
    expect(channels).toContain("email");
    expect(channels).toContain("push");
    expect(logs.every((l) => l["status"] === "sent")).toBe(true);
  });

  test("ticket without assignee skips notification (recipient returns null)", async () => {
    emailTransport.sent.length = 0;
    pushTransport.sent.length = 0;

    await stack.http.writeOk(
      "support:write:ticket:create",
      {
        title: "Dokumentation ueberarbeiten",
        description: "Die API-Docs sind veraltet.",
        priority: "low",
        status: "open",
      },
      admin,
    );

    // No notifications sent — no assignee
    expect(emailTransport.sent).toHaveLength(0);
    expect(pushTransport.sent).toHaveLength(0);
  });

  test("access control: non-Admin/Support cannot create tickets", async () => {
    const normalUser = createTestUser({ id: 99, roles: ["User"] });
    const error = await stack.http.writeErr(
      "support:write:ticket:create",
      {
        title: "Hacked ticket",
        priority: "normal",
        status: "open",
      },
      normalUser,
    );
    expectErrorIncludes(error, "access_denied");
  });
});
