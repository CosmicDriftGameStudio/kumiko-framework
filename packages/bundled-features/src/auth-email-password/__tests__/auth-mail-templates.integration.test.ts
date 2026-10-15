// Auth mails are stored templates: a tenant can override the system text, a
// missing variable fails the sending write instead of a broken mail, and the
// boot seed is idempotent (the generated html must equal what the seed stores).

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { defineFeature, defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { registerMailTranslations } from "@cosmicdrift/kumiko-framework/i18n";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import { localeDeBundle } from "@cosmicdrift/kumiko-locale-de";
import * as z from "zod";
import { createChannelEmailFeature, createInMemoryTransport } from "../../channel-email/index.js";
import { createConfigFeature } from "../../config/index.js";
import { createConfigResolver } from "../../config/resolver.js";
import { configValuesTable } from "../../config/table.js";
import { createDeliveryFeature, createDeliveryTestContext } from "../../delivery/index.js";
import { deliveryAttemptsTable, notificationPreferencesTable } from "../../delivery/tables.js";
import { createRendererSimpleFeature, simpleRenderer } from "../../renderer-simple/index.js";
import { hashPassword } from "../../shared/index.js";
import { TemplateResolverHandlers } from "../../template-resolver/qualified-names.js";
import { createTenantFeature } from "../../tenant/index.js";
import { tenantInvitationEntity } from "../../tenant/invitation-table.js";
import { tenantMembershipsTable } from "../../tenant/membership-table.js";
import { tenantEntity } from "../../tenant/schema/tenant.js";
import { seedTenant, seedTenantMembership } from "../../tenant/seeding.js";
import { createUserFeature } from "../../user/feature.js";
import { userEntity } from "../../user/schema/user.js";
import { AuthHandlers } from "../constants.js";
import { createAuthEmailPasswordFeature } from "../feature.js";
import { AuthMailNotificationTypes } from "../mail-notifications.js";
import { seedUser } from "../seeding.js";
import { authMailRendererFeatures, seedAuthMailTemplates } from "./auth-mail-stack.js";

registerMailTranslations("de", localeDeBundle);

const APP_ACCEPT_URL = "https://app.example.com/invite/accept";
const emailTransport = createInMemoryTransport();

const probeFeature = defineFeature("auth-mail-probe", (r) => {
  r.requires("delivery");
  r.writeHandler(
    defineWriteHandler({
      name: "invite-without-link",
      schema: z.object({ email: z.string() }),
      access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
      handler: async (event, ctx) => {
        if (!ctx.notify) throw new Error("notify is not wired");
        await ctx.notify(AuthMailNotificationTypes.invite, {
          route: { email: event.payload.email },
          // actionUrl, validFor, validUntil and role are required by the template.
          data: { appName: "Probe" },
        });
        return { isSuccess: true, data: {} };
      },
    }),
  );
});

let stack: TestStack;
let tenantId: ReturnType<typeof crypto.randomUUID>;
let adminId: string;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createUserFeature(),
      createTenantFeature(),
      ...authMailRendererFeatures(),
      createDeliveryFeature(),
      createRendererSimpleFeature(),
      createChannelEmailFeature({
        transport: emailTransport,
        renderer: simpleRenderer,
        resolveEmail: async () => "unused@test.local",
      }),
      createAuthEmailPasswordFeature({ invite: { tokenTtlMinutes: 60, appUrl: APP_ACCEPT_URL } }),
      probeFeature,
    ],
    extraContext: (deps) => ({
      ...createDeliveryTestContext(deps),
      configResolver: createConfigResolver(),
    }),
    authConfig: {
      membershipQuery: "tenant:query:memberships",
      loginHandler: AuthHandlers.login,
    },
  });
  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafeCreateEntityTable(stack.db, tenantEntity);
  await unsafeCreateEntityTable(stack.db, tenantInvitationEntity);
  await unsafePushTables(stack.db, {
    configValuesTable,
    tenantMembershipsTable,
    notificationPreferencesTable,
    deliveryAttemptsTable,
  });
  await seedAuthMailTemplates(stack);

  tenantId = crypto.randomUUID();
  await seedTenant(stack.db, { id: tenantId, key: `t-${tenantId.slice(0, 8)}`, name: "Tenant" });
  ({ id: adminId } = await seedUser(stack.db, {
    email: "admin@example.com",
    displayName: "Admin",
    passwordHash: await hashPassword("admin-pw-1234"),
    emailVerified: true,
  }));
  await seedTenantMembership(stack.db, { userId: adminId, tenantId, roles: ["Admin"] });
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  emailTransport.sent.length = 0;
  await stack.redis.flushNamespace();
});

function adminSession() {
  return { id: adminId, tenantId, roles: ["Admin"] };
}

function tenantAdminSession() {
  return { id: adminId, tenantId, roles: ["TenantAdmin"] };
}

const INVITE_SLUG = AuthMailNotificationTypes.invite;

const overrideBody =
  '<p>OVERRIDE for <span data-variable="appName"></span> as <span data-variable="role"></span>,' +
  ' valid <span data-variable="validFor"></span> until <span data-variable="validUntil"></span></p>' +
  '<p><a data-button href="{{actionUrl}}">Join now</a></p>';

describe("auth mail templates", () => {
  test("a tenant's published template replaces the system text for that tenant's mails", async () => {
    await stack.http.writeOk(
      AuthHandlers.inviteCreate,
      { email: "before@example.com", role: "Admin" },
      adminSession(),
    );
    expect(emailTransport.sent[0]?.text).not.toContain("OVERRIDE");

    const draft = await stack.http.writeOk<{ id: string }>(
      TemplateResolverHandlers.upsertTenant,
      {
        slug: INVITE_SLUG,
        kind: "mail",
        locale: "en",
        content: overrideBody,
        contentFormat: "html",
        meta: { subject: "Tenant subject for {{appName}}" },
        variableSchema: {},
        linkedResources: {},
      },
      tenantAdminSession(),
    );
    await stack.http.writeOk(
      TemplateResolverHandlers.publish,
      { id: draft.id },
      tenantAdminSession(),
    );

    await stack.http.writeOk(
      AuthHandlers.inviteCreate,
      { email: "after@example.com", role: "Admin" },
      adminSession(),
    );
    const sent = emailTransport.sent.at(-1);
    expect(sent?.to).toBe("after@example.com");
    expect(sent?.subject).toBe("Tenant subject for Workspace");
    expect(sent?.text).toContain("OVERRIDE");
    expect(sent?.text).toContain(`${APP_ACCEPT_URL}?token=`);
  });

  test("a write that notifies without a required variable fails and sends nothing", async () => {
    const attemptsBefore = (await selectMany(stack.db, deliveryAttemptsTable, {})).length;
    const err = await stack.http.writeErr(
      "auth-mail-probe:write:invite-without-link",
      { email: "nobody@example.com" },
      adminSession(),
    );

    expect(String(err.message ?? "")).toContain(INVITE_SLUG);
    expect(emailTransport.sent).toHaveLength(0);
    expect(await selectMany(stack.db, deliveryAttemptsTable, {})).toHaveLength(attemptsBefore);
  });

  test("the boot seed is idempotent: a second run writes no event", async () => {
    const before = await selectMany(stack.db, eventsTable, {});
    expect(before.length).toBeGreaterThan(0);

    await seedAuthMailTemplates(stack);

    expect(await selectMany(stack.db, eventsTable, {})).toHaveLength(before.length);
  });
});
