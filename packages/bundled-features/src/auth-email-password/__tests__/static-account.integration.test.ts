import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { createAuthFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/auth-foundation";
import {
  type SessionUser,
  SYSTEM_TENANT_ID,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { registerMailTranslations } from "@cosmicdrift/kumiko-framework/i18n";
import { TestUsers } from "@cosmicdrift/kumiko-framework/seeding";
import { localeDeBundle } from "@cosmicdrift/kumiko-locale-de";
import { createTestEnvelopeCipher, resetTestTables } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import { createChannelEmailFeature, createInMemoryTransport } from "../../channel-email/index.ts";
import { createConfigFeature } from "../../config/index.ts";
import { createConfigResolver } from "../../config/resolver.ts";
import { configValuesTable } from "../../config/table.ts";
import { createDeliveryFeature, createDeliveryTestContext } from "../../delivery/index.ts";
import { notificationPreferencesTable } from "../../delivery/tables.ts";
import { createSessionsFeature, userSessionTable } from "../../sessions/index.ts";
import { routeFetchToStack } from "../../shared/__tests__/fetch-test-utils.ts";
import { hashPassword } from "../../shared/index.ts";
import { createTenantFeature, TenantHandlers } from "../../tenant/index.ts";
import { tenantInvitationEntity, tenantInvitationsTable } from "../../tenant/invitation-table.ts";
import { tenantMembershipsTable } from "../../tenant/membership-table.ts";
import { tenantEntity, tenantTable } from "../../tenant/schema/tenant.ts";
import { seedTenantMembership } from "../../tenant/testing.ts";
import { createUserFeature } from "../../user/feature.ts";
import { UserHandlers } from "../../user/index.ts";
import { userEntity, userTable } from "../../user/schema/user.ts";
import { createAuthEmailPasswordFeature } from "../feature.ts";
import { AuthHandlers, AuthQueries } from "../web/constants.ts";
import {
  acceptInviteWithNewAccount,
  fetchInviteInfo,
  fetchSignupRegistrationStatus,
  requestPasswordReset,
  resetPassword,
} from "../web/static-account.ts";
import { authMailRendererFeatures, seedAuthMailTemplates } from "./auth-mail-stack.ts";

registerMailTranslations("de", localeDeBundle);

const emailTransport = createInMemoryTransport();
const realFetch = globalThis.fetch;
const NEW_PASSWORD = "static-account-pw-1234";
const TENANT_ID = "00000000-0000-4000-8000-0000000000a1" as TenantId;

let stack: TestStack;

beforeAll(async () => {
  const encryption = createTestEnvelopeCipher(randomBytes(32).toString("base64"));
  stack = await setupTestStack({
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
      createAuthEmailPasswordFeature({
        passwordReset: {
          hmacSecret: randomBytes(32).toString("base64"),
          tokenTtlMinutes: 15,
          appUrl: "https://app.example.com/reset",
        },
        invite: { tokenTtlMinutes: 60, appUrl: "https://app.example.com/invite/accept" },
        signup: { tokenTtlMinutes: 60, appUrl: "https://app.example.com/signup/activate" },
      }),
      createAuthFoundationFeature(),
      createSessionsFeature(),
    ],
    extraContext: (deps) => ({
      ...createDeliveryTestContext(deps),
      configResolver: createConfigResolver({ cipher: encryption }),
      configEncryption: encryption,
    }),
    authConfig: {
      membershipQuery: "tenant:query:memberships",
      loginHandler: AuthHandlers.login,
      passwordReset: {
        requestHandler: AuthHandlers.requestPasswordReset,
        confirmHandler: AuthHandlers.resetPassword,
      },
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
  });
  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafeCreateEntityTable(stack.db, tenantEntity);
  await unsafeCreateEntityTable(stack.db, tenantInvitationEntity);
  await unsafePushTables(stack.db, {
    configValuesTable,
    tenantMembershipsTable,
    userSessionTable,
    notificationPreferencesTable,
  });
  await seedAuthMailTemplates(stack);
});

afterAll(async () => {
  globalThis.fetch = realFetch;
  await stack.cleanup();
});

beforeEach(async () => {
  await resetTestTables(stack.db, [
    userTable,
    tenantMembershipsTable,
    tenantInvitationsTable,
    tenantTable,
    userSessionTable,
    eventsTable,
  ]);
  emailTransport.sent.length = 0;
  await stack.redis.flushNamespace();
  routeFetchToStack(stack);
});

function tokenFromLastMailTo(email: string): string {
  const mail = emailTransport.sent.filter((sent) => sent.to === email).at(-1);
  const match = (mail?.text ?? "").match(/[?&]token=([^&"'<\s\]]+)/);
  if (!match?.[1]) throw new Error(`no token in mail to ${email}`);
  return decodeURIComponent(match[1]);
}

describe("signup registration status", () => {
  test("reads the anonymous status query", async () => {
    expect(await fetchSignupRegistrationStatus()).toEqual({
      kind: "success",
      data: { enabled: true },
    });
  });
});

describe("password reset", () => {
  test("mails a link, the token resets the password once", async () => {
    const created = await stack.http.writeOk<{ id: string }>(
      UserHandlers.create,
      {
        email: "reset@static.test",
        passwordHash: await hashPassword("old-password-123"),
        displayName: "Reset",
      },
      TestUsers.systemAdmin,
    );
    await seedTenantMembership(stack.db, {
      userId: created.id,
      tenantId: TENANT_ID,
      roles: ["User"],
    });

    expect(await requestPasswordReset("reset@static.test", { locale: "en" })).toEqual({
      kind: "success",
      data: undefined,
    });
    const token = tokenFromLastMailTo("reset@static.test");

    expect(await resetPassword(token, NEW_PASSWORD)).toEqual({ kind: "success", data: undefined });
    expect((await resetPassword("not-a-valid-token-at-all", NEW_PASSWORD)).kind).toBe("failure");
  });
});

describe("invitations", () => {
  test("looks up the invitation and accepts it with a new account", async () => {
    const tenantAdmin: SessionUser = {
      id: crypto.randomUUID(),
      tenantId: TENANT_ID,
      roles: ["TenantAdmin"],
    };
    await stack.http.writeOk(
      TenantHandlers.create,
      { id: TENANT_ID, key: "static-acct", name: "Static Acct" },
      TestUsers.systemAdmin,
    );
    await stack.http.writeOk(
      AuthHandlers.inviteCreate,
      { email: "invitee@static.test", role: "Editor" },
      tenantAdmin,
    );
    const token = tokenFromLastMailTo("invitee@static.test");

    expect(await fetchInviteInfo(token)).toEqual({
      kind: "success",
      data: { email: "invitee@static.test", hasAccount: false },
    });
    const accepted = await acceptInviteWithNewAccount(token, NEW_PASSWORD);
    expect(accepted).toMatchObject({
      kind: "success",
      data: { status: "accepted", tenantId: TENANT_ID },
    });
    expect((await fetchInviteInfo(token)).kind).toBe("failure");
  });
});
