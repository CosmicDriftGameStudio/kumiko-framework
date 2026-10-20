// Sample Integration Test: Delivery Notifications
//
// Proves the notification path end-to-end:
// 1. The boot seed writes the declared mail template into the template store
// 2. Admin creates a ticket with assignee (via HTTP API), the handler sends via ctx.notify
// 3. InApp → DB + SSE
// 4. Email → stored template → mail renderer → Transport
// 5. Push → Transport
// 6. DeliveryLog has entries for all 3 channels
// 7. A tenant overrides the stored mail text and the next mail uses it

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
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
import { createRendererFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/renderer-foundation";
import {
  createTemplateResolverFeature,
  TemplateResolverHandlers,
} from "@cosmicdrift/kumiko-bundled-features/template-resolver";
import { seedNotificationTemplates } from "@cosmicdrift/kumiko-bundled-features/template-resolver/seeding";
import {
  createTenantFeature,
  TenantQueries,
  tenantMembershipsTable,
} from "@cosmicdrift/kumiko-bundled-features/tenant";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import type { SessionUser } from "@cosmicdrift/kumiko-framework/engine";
import { createEventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { createTestUser, TestUsers } from "@cosmicdrift/kumiko-framework/seeding";
import { createRendererMailHtmlFeature } from "@cosmicdrift/kumiko-renderer-mail-html";
import { expectErrorIncludes } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import { supportFeature, TICKET_ASSIGNED, ticketTable } from "../feature";

// --- Test Infrastructure ---

const emailTransport = createInMemoryTransport();
const pushTransport = createInMemoryPushTransport();

// Simple resolvers: userId → address
const testEmail = (userId: string) => `user-${userId}@example.com`;
const testPushToken = (userId: string) => `push-token-${userId}`;

// Test users
const admin: SessionUser = TestUsers.admin;
const assignee = createTestUser({ id: 5, roles: ["Support"] });

// --- Feature Setup ---

const features = [
  createConfigFeature(),
  createTenantFeature(),
  createTemplateResolverFeature({
    tenantEditable: [{ kind: "mail", slug: TICKET_ASSIGNED, access: { roles: ["TenantAdmin"] } }],
  }),
  createRendererFoundationFeature(),
  createRendererMailHtmlFeature(),
  createDeliveryFeature(),
  createChannelInAppFeature(),
  createChannelEmailFeature({
    transport: emailTransport,
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

  await unsafePushTables(db, {
    inAppMessagesTable,
    notificationPreferencesTable,
    tenantMembershipsTable,
    ticketTable,
  });
  await createEventsTable(db);
  // setupTestStack does not run boot seeds; a real app seeds at boot.
  await seedNotificationTemplates(db, stack.registry);
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
    const inAppMessages = await selectMany(db, inAppMessagesTable, { userId: assignee.id });
    expect(inAppMessages).toHaveLength(1);
    expect(inAppMessages[0]?.["title"]).toBe("New ticket: Login-Button reagiert nicht");
    expect(inAppMessages[0]?.["body"]).toContain("Nach Klick auf Login");

    const sseEvents = stack.events.sse.filter((e) => e.type === "channel-in-app:event:delivered");
    expect(sseEvents).toHaveLength(1);
    expect(sseEvents[0]?.data["userId"]).toBe(assignee.id);

    // --- Assert: Email ---
    const email = emailTransport.sent.find((e: EmailMessage) => e.to === testEmail(assignee.id));
    expect(email).toBeDefined();
    expect(email?.subject).toContain("Support ticket #");
    expect(email?.subject).toContain("(critical)");
    expect(email?.html).toContain("Login-Button reagiert nicht"); // title
    expect(email?.html).toContain("Nach Klick auf Login"); // description
    expect(email?.html).toContain("Priority: critical");
    expect(email?.html).toContain("Open ticket"); // button
    expect(email?.html).toContain("/support/tickets/"); // button URL

    // --- Assert: Push ---
    const push = pushTransport.sent.find(
      (p: PushMessage) => p.token === testPushToken(assignee.id),
    );
    expect(push).toBeDefined();
    expect(push?.title).toBe("New ticket");
    expect(push?.body).toContain("Login-Button");
    expect(push?.body).toContain("critical");

    // --- Assert: DeliveryLog has entries for all 3 channels ---
    const logs = await selectMany(db, deliveryAttemptsTable, {
      notificationType: TICKET_ASSIGNED,
      recipientId: assignee.id,
    });
    expect(logs).toHaveLength(3);
    const channels = logs.map((l) => l["channel"]);
    expect(channels).toContain("inApp");
    expect(channels).toContain("email");
    expect(channels).toContain("push");
    expect(logs.every((l) => l["status"] === "sent")).toBe(true);
  });

  test("a tenant override of the stored mail text replaces the system text", async () => {
    emailTransport.sent.length = 0;
    const tenantAdmin = { ...admin, roles: ["TenantAdmin"] };

    const draft = await stack.http.writeOk<{ id: string }>(
      TemplateResolverHandlers.upsertTenant,
      {
        slug: TICKET_ASSIGNED,
        kind: "mail",
        locale: "en",
        content:
          '<p>Tenant text: <span data-variable="title"></span></p><p><span data-variable="description"></span> (<span data-variable="priority"></span>)</p><p><a data-button href="{{url}}">Open</a></p>',
        contentFormat: "html",
        meta: { subject: "Tenant subject #{{ticketId}}" },
        variableSchema: {},
      },
      tenantAdmin,
    );
    await stack.http.writeOk(TemplateResolverHandlers.publish, { id: draft.id }, tenantAdmin);

    await stack.http.writeOk(
      "support:write:ticket:create",
      { title: "Printer on fire", assigneeId: assignee.id, priority: "normal", status: "open" },
      admin,
    );

    const email = emailTransport.sent.find((e: EmailMessage) => e.to === testEmail(assignee.id));
    expect(email?.subject).toContain("Tenant subject #");
    expect(email?.html).toContain("Tenant text: Printer on fire");
  });

  test("a tenant admin may not override a mail the app did not list in tenantEditable", async () => {
    const tenantAdmin = { ...admin, roles: ["TenantAdmin"] };

    const error = await stack.http.writeErr(
      TemplateResolverHandlers.upsertTenant,
      {
        slug: "support:notify:ticket-closed",
        kind: "mail",
        locale: "en",
        content: "<p>Closed</p>",
        contentFormat: "html",
        meta: { subject: "Closed" },
        variableSchema: {},
      },
      tenantAdmin,
    );

    expect(error.code).toBe("access_denied");
    expect(error.i18nKey).toBe("templateResolver.errors.templateNotTenantEditable");
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
