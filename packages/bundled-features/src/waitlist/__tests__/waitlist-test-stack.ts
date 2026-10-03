import { expect } from "bun:test";
import { authFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/auth-foundation";
import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import type { SessionUser } from "@cosmicdrift/kumiko-framework/engine";
import { SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import { getSetCookieValue, resetTestTables } from "@cosmicdrift/kumiko-framework/testing";
import { parseRoles } from "@cosmicdrift/kumiko-framework/utils";
import { AuthHandlers, AuthQueries } from "../../auth-email-password/constants.js";
import { createAuthEmailPasswordFeature } from "../../auth-email-password/feature.js";
import { createChannelEmailFeature, createInMemoryTransport } from "../../channel-email/index.js";
import {
  createComplianceProfilesFeature,
  tenantComplianceProfileEntity,
  tenantComplianceProfileTable,
} from "../../compliance-profiles/index.js";
import { configValueEntity, createConfigFeature } from "../../config/index.js";
import { createConfigResolver } from "../../config/resolver.js";
import { configValuesTable } from "../../config/table.js";
import { createDataRetentionFeature } from "../../data-retention/index.js";
import { createDeliveryFeature, createDeliveryTestContext } from "../../delivery/index.js";
import { notificationPreferencesTable } from "../../delivery/tables.js";
import { createRendererFoundationFeature } from "../../renderer-foundation/feature.js";
import { createRendererSimpleFeature, simpleRenderer } from "../../renderer-simple/index.js";
import { createSessionsFeature, userSessionEntity } from "../../sessions/index.js";
import { createTemplateResolverFeature } from "../../template-resolver/feature.js";
import { createTenantFeature } from "../../tenant/index.js";
import { tenantInvitationEntity, tenantInvitationsTable } from "../../tenant/invitation-table.js";
import { tenantMembershipsTable } from "../../tenant/membership-table.js";
import { tenantEntity, tenantTable } from "../../tenant/schema/tenant.js";
import { createUserFeature } from "../../user/feature.js";
import { userEntity, userTable } from "../../user/schema/user.js";
import { createUserDataRightsFeature } from "../../user-data-rights/feature.js";
import { waitlistEntryEntity, waitlistEntryTable } from "../entity.js";
import { createWaitlistFeature } from "../feature.js";
import type { WaitlistOptions } from "../options.js";

export const emailTransport = createInMemoryTransport();

export const SYSTEM_ADMIN: SessionUser = {
  id: crypto.randomUUID(),
  tenantId: SYSTEM_TENANT_ID,
  roles: ["SystemAdmin"],
};

export const INVITE_PASSWORD = "waitlist-new-pw-1234";

export async function createWaitlistTestStack(
  waitlistOptions: WaitlistOptions,
): Promise<TestStack> {
  const stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createUserFeature(),
      createTenantFeature(),
      createTemplateResolverFeature(),
      createRendererFoundationFeature(),
      createDeliveryFeature(),
      createRendererSimpleFeature(),
      createChannelEmailFeature({
        transport: emailTransport,
        renderer: simpleRenderer,
        resolveEmail: async () => "unused@test.local",
      }),
      createDataRetentionFeature(),
      createComplianceProfilesFeature(),
      authFoundationFeature,
      createSessionsFeature(),
      createAuthEmailPasswordFeature({
        invite: { tokenTtlMinutes: 60, appUrl: "https://app.example.com/invite/accept" },
      }),
      createUserDataRightsFeature(),
      createWaitlistFeature(waitlistOptions),
    ],
    extraContext: (deps) => ({
      ...createDeliveryTestContext(deps),
      configResolver: createConfigResolver(),
    }),
    authConfig: {
      membershipQuery: "tenant:query:memberships",
      loginHandler: AuthHandlers.login,
      invite: {
        acceptHandler: AuthHandlers.inviteAccept,
        acceptWithLoginHandler: AuthHandlers.inviteAcceptWithLogin,
        signupCompleteHandler: AuthHandlers.inviteSignupComplete,
        infoHandler: AuthQueries.inviteInfo,
      },
    },
    anonymousAccess: { defaultTenantId: SYSTEM_TENANT_ID },
    trustedProxyHops: 1,
  });

  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafeCreateEntityTable(stack.db, tenantEntity);
  await unsafeCreateEntityTable(stack.db, tenantInvitationEntity);
  await unsafeCreateEntityTable(stack.db, waitlistEntryEntity);
  await unsafeCreateEntityTable(stack.db, userSessionEntity);
  await unsafeCreateEntityTable(stack.db, tenantComplianceProfileEntity);
  await unsafeCreateEntityTable(stack.db, configValueEntity);
  await unsafePushTables(stack.db, {
    configValuesTable,
    tenantMembershipsTable,
    notificationPreferencesTable,
  });
  return stack;
}

export async function resetWaitlistTestState(stack: TestStack): Promise<void> {
  await resetTestTables(stack.db, [
    userTable,
    tenantMembershipsTable,
    tenantInvitationsTable,
    tenantTable,
    waitlistEntryTable,
    tenantComplianceProfileTable,
  ]);
  emailTransport.sent.length = 0;
  // The submit bucket is per IP; one test's calls must not push another over the limit.
  await stack.redis.flushNamespace();
}

export function mailsTo(email: string) {
  return emailTransport.sent.filter((mail) => mail.to === email);
}

export function tokenFromLastMailTo(email: string): string {
  const mail = mailsTo(email).at(-1);
  if (!mail) throw new Error(`no mail to ${email}`);
  const match = mail.html.match(/[?&]token=([^&"'<\s]+)/);
  if (!match?.[1]) throw new Error(`no token in mail to ${email}`);
  return decodeURIComponent(match[1]);
}

export async function acceptInviteAsNewUser(stack: TestStack, email: string): Promise<void> {
  const res = await stack.http.raw("POST", "/api/auth/invite-signup-complete", {
    token: tokenFromLastMailTo(email),
    password: INVITE_PASSWORD,
  });
  expect(res.status).toBe(200);
}

export async function loginCookies(
  stack: TestStack,
  email: string,
): Promise<Record<string, string>> {
  const res = await stack.http.raw("POST", "/api/auth/login", {
    email,
    password: INVITE_PASSWORD,
  });
  expect(res.status).toBe(200);
  const auth = getSetCookieValue(res, "kumiko_auth");
  const csrf = getSetCookieValue(res, "kumiko_csrf");
  if (!auth || !csrf) throw new Error("login set no session cookies");
  return { Cookie: `kumiko_auth=${auth}; kumiko_csrf=${csrf}`, "X-CSRF-Token": csrf };
}

export async function userRowOf(stack: TestStack, email: string) {
  const [row] = await selectMany(stack.db, userTable, { email });
  if (!row) throw new Error(`no user ${email}`);
  return { id: String(row["id"]), globalRoles: parseRoles(row["roles"]) };
}
