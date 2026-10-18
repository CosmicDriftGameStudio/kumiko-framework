import { expect } from "bun:test";
import { createAuthFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/auth-foundation";
import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import type { SessionUser } from "@cosmicdrift/kumiko-framework/engine";
import { SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
import { parseRoles } from "@cosmicdrift/kumiko-framework/utils";
import { getSetCookieValue, resetTestTables } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import {
  authMailRendererFeatures,
  seedAuthMailTemplates,
} from "../../auth-email-password/__tests__/auth-mail-stack.ts";
import { AuthHandlers, AuthQueries } from "../../auth-email-password/constants.ts";
import { createAuthEmailPasswordFeature } from "../../auth-email-password/feature.ts";
import { createChannelEmailFeature, createInMemoryTransport } from "../../channel-email/index.ts";
import {
  createComplianceProfilesFeature,
  tenantComplianceProfileEntity,
  tenantComplianceProfileTable,
} from "../../compliance-profiles/index.ts";
import { configValueEntity, createConfigFeature } from "../../config/index.ts";
import { createConfigResolver } from "../../config/resolver.ts";
import { configValuesTable } from "../../config/table.ts";
import { createDataRetentionFeature } from "../../data-retention/index.ts";
import { createDeliveryFeature, createDeliveryTestContext } from "../../delivery/index.ts";
import { notificationPreferencesTable } from "../../delivery/tables.ts";
import { createSessionsFeature, userSessionEntity } from "../../sessions/index.ts";
import { createTenantFeature } from "../../tenant/index.ts";
import { tenantInvitationEntity, tenantInvitationsTable } from "../../tenant/invitation-table.ts";
import { tenantMembershipsTable } from "../../tenant/membership-table.ts";
import { tenantEntity, tenantTable } from "../../tenant/schema/tenant.ts";
import { createUserFeature } from "../../user/feature.ts";
import { userEntity, userTable } from "../../user/schema/user.ts";
import { createUserDataRightsFeature } from "../../user-data-rights/feature.ts";
import { waitlistEntryEntity, waitlistEntryTable } from "../entity.ts";
import { createWaitlistFeature } from "../feature.ts";
import type { WaitlistOptions } from "../options.ts";

export const emailTransport = createInMemoryTransport();

export const SYSTEM_ADMIN: SessionUser = {
  id: crypto.randomUUID(),
  tenantId: SYSTEM_TENANT_ID,
  roles: ["SystemAdmin"],
};

export const INVITE_PASSWORD = "waitlist-new-pw-1234";

export async function createWaitlistTestStack(
  waitlistOptions: WaitlistOptions,
  extraContext: Record<string, unknown> = {},
): Promise<TestStack> {
  const stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createUserFeature(),
      createTenantFeature(),
      ...authMailRendererFeatures(),
      createDeliveryFeature(),
      createChannelEmailFeature({
        transport: emailTransport,
        resolveEmail: async () => "unused@test.local",
      }),
      createDataRetentionFeature(),
      createComplianceProfilesFeature(),
      createAuthFoundationFeature(),
      createSessionsFeature(),
      createAuthEmailPasswordFeature({
        invite: { tokenTtlMinutes: 60, appUrl: "https://app.example.com/invite/accept" },
        signup: { tokenTtlMinutes: 60, appUrl: "https://app.example.com/signup/activate" },
      }),
      createUserDataRightsFeature(),
      createWaitlistFeature(waitlistOptions),
    ],
    extraContext: (deps) => ({
      ...createDeliveryTestContext(deps),
      configResolver: createConfigResolver(),
      ...extraContext,
    }),
    authConfig: {
      membershipQuery: "tenant:query:memberships",
      loginHandler: AuthHandlers.login,
      signup: {
        requestHandler: AuthHandlers.signupRequest,
        confirmHandler: AuthHandlers.signupConfirm,
      },
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
  await seedAuthMailTemplates(stack);
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
  const match = (mail.text ?? "").match(/[?&]token=([^&"'<\s\]]+)/);
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

export async function signUpOpenly(stack: TestStack, email: string): Promise<void> {
  const request = await stack.http.raw(
    "POST",
    "/api/auth/signup-request",
    { email },
    { "x-forwarded-for": email },
  );
  expect(request.status).toBe(200);
  const confirm = await stack.http.raw("POST", "/api/auth/signup-confirm", {
    token: tokenFromLastMailTo(email),
    password: INVITE_PASSWORD,
  });
  expect(confirm.status).toBe(200);
}
