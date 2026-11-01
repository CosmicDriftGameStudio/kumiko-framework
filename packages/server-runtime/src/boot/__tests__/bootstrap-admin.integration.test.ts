// The creator of a freshly scaffolded app is seeded as admin WITHOUT a password and sets one
// through the real password-reset flow.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import {
  AuthHandlers,
  createAuthEmailPasswordFeature,
} from "@cosmicdrift/kumiko-bundled-features/auth-email-password";
import { seedUserWithPassword } from "@cosmicdrift/kumiko-bundled-features/auth-email-password/seeding";
import {
  createChannelEmailFeature,
  createInMemoryTransport,
} from "@cosmicdrift/kumiko-bundled-features/channel-email";
import { createConfigFeature } from "@cosmicdrift/kumiko-bundled-features/config";
import {
  createDeliveryFeature,
  createDeliveryTestContext,
} from "@cosmicdrift/kumiko-bundled-features/delivery";
import { BOOTSTRAP_ADMIN_EMAIL_ENV } from "@cosmicdrift/kumiko-bundled-features/foundation-shared";
import { createRendererFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/renderer-foundation";
import { createTemplateResolverFeature } from "@cosmicdrift/kumiko-bundled-features/template-resolver";
import {
  createTenantFeature,
  tenantMembershipsTable,
} from "@cosmicdrift/kumiko-bundled-features/tenant";
import { createUserFeature, userTable } from "@cosmicdrift/kumiko-bundled-features/user";
import { ROLES } from "@cosmicdrift/kumiko-framework/auth";
import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { registerMailTranslations } from "@cosmicdrift/kumiko-framework/i18n";
import { localeDeBundle } from "@cosmicdrift/kumiko-locale-de";
import { createRendererMailHtmlFeature } from "@cosmicdrift/kumiko-renderer-mail-html";
import { resetTestTables } from "@cosmicdrift/kumiko-testing/helpers";
import { setupTestStack, type TestStack } from "@cosmicdrift/kumiko-testing/stack";
import type { TenantId } from "@cosmicdrift/kumiko-types/identifiers";
import { resolveSeedShortcuts } from "../../boot-options/seed-shortcuts.ts";
import { applyStandardBootSeeds } from "../shared-boot-steps.ts";

registerMailTranslations("de", localeDeBundle);

const TENANT_ID = "00000000-0000-4000-8000-0000000000b1" as TenantId;
const CREATOR_EMAIL = "creator@example.com";
const NEW_PASSWORD = "chosen-by-creator-12345";
const APP_RESET_URL = "https://app.example.com/reset-password";

const emailTransport = createInMemoryTransport();
let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createUserFeature(),
      createTenantFeature(),
      createTemplateResolverFeature(),
      createRendererFoundationFeature(),
      createRendererMailHtmlFeature(),
      createDeliveryFeature(),
      createChannelEmailFeature({
        transport: emailTransport,
        resolveEmail: async () => "unused@test.local",
      }),
      createAuthEmailPasswordFeature({
        passwordReset: {
          hmacSecret: randomBytes(32).toString("base64"),
          tokenTtlMinutes: 15,
          appUrl: APP_RESET_URL,
        },
      }),
    ],
    extraContext: (deps) => createDeliveryTestContext(deps),
    authConfig: {
      membershipQuery: "tenant:query:memberships",
      loginHandler: AuthHandlers.login,
      passwordReset: {
        requestHandler: AuthHandlers.requestPasswordReset,
        confirmHandler: AuthHandlers.resetPassword,
      },
    },
  });
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await resetTestTables(stack.db, [userTable, tenantMembershipsTable, eventsTable]);
  emailTransport.sent.length = 0;
});

function bootSeeds(envSource: Record<string, string | undefined>) {
  return applyStandardBootSeeds({
    db: stack.db,
    registry: stack.registry,
    admin: undefined,
    shortcutSeeds: resolveSeedShortcuts(
      {
        bootstrapAdminFromEnv: { tenant: { id: TENANT_ID, key: "app", name: "App" } },
      },
      { envSource, hasAuth: true, hasAuthAdmin: false },
    ),
    cipher: undefined,
    processName: "test",
  });
}

const withCreator = { [BOOTSTRAP_ADMIN_EMAIL_ENV]: CREATOR_EMAIL };

function login(password: string): Promise<Response> {
  return stack.http.raw("POST", "/api/auth/login", { email: CREATOR_EMAIL, password });
}

async function creatorRows() {
  return selectMany(stack.db, userTable, { email: CREATOR_EMAIL });
}

function rolesOf(raw: unknown): unknown {
  return typeof raw === "string" ? JSON.parse(raw) : raw;
}

describe("bootstrap admin seed", () => {
  test("seeds a verified admin without a password, a SystemAdmin globally and Admin + TenantAdmin in the tenant", async () => {
    await bootSeeds(withCreator);

    const [user] = await creatorRows();
    expect(user?.["passwordHash"] ?? null).toBeNull();
    expect(user?.["emailVerified"]).toBe(true);
    expect(rolesOf(user?.["roles"])).toEqual([ROLES.SystemAdmin]);

    const memberships = await selectMany(stack.db, tenantMembershipsTable, {
      userId: user?.["id"] as string,
      tenantId: TENANT_ID,
    });
    expect(memberships).toHaveLength(1);
    expect(rolesOf(memberships[0]?.["roles"])).toEqual(["Admin", ROLES.TenantAdmin]);
  });

  test("login is refused while no password is set", async () => {
    await bootSeeds(withCreator);

    const res = await login("anything-at-all-123456");
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect((await res.json()).token).toBeUndefined();
  });

  test("password reset sets the password and the login works", async () => {
    await bootSeeds(withCreator);

    const requested = await stack.http.raw("POST", "/api/auth/request-password-reset", {
      email: CREATOR_EMAIL,
    });
    expect(requested.status).toBe(200);
    const mail = emailTransport.sent.find((sent) => sent.to === CREATOR_EMAIL);
    const token = mail?.text?.match(/\?token=([^&\s]+)/)?.[1];
    if (token === undefined) throw new Error("reset mail with token missing");

    const reset = await stack.http.raw("POST", "/api/auth/reset-password", {
      token: decodeURIComponent(token),
      newPassword: NEW_PASSWORD,
    });
    expect(reset.status).toBe(200);

    const res = await login(NEW_PASSWORD);
    expect(res.status).toBe(200);
    expect(typeof (await res.json()).token).toBe("string");
  });

  test("a second boot keeps the account and the chosen password", async () => {
    await bootSeeds(withCreator);
    const [first] = await creatorRows();
    await stack.http.raw("POST", "/api/auth/request-password-reset", { email: CREATOR_EMAIL });
    const token = emailTransport.sent
      .find((sent) => sent.to === CREATOR_EMAIL)
      ?.text?.match(/\?token=([^&\s]+)/)?.[1];
    if (token === undefined) throw new Error("reset mail with token missing");
    await stack.http.raw("POST", "/api/auth/reset-password", {
      token: decodeURIComponent(token),
      newPassword: NEW_PASSWORD,
    });

    await bootSeeds(withCreator);

    const rows = await creatorRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.["id"]).toBe(first?.["id"]);
    expect((await login(NEW_PASSWORD)).status).toBe(200);
  });

  test("two instances booting at once create exactly one account", async () => {
    await Promise.all([bootSeeds(withCreator), bootSeeds(withCreator)]);

    expect(await creatorRows()).toHaveLength(1);
  });

  test("an existing account with its own password is left untouched", async () => {
    const ownPassword = "self-registered-pw-12345";
    await seedUserWithPassword(stack.db, {
      email: CREATOR_EMAIL,
      password: ownPassword,
      displayName: "Someone else",
    });

    await bootSeeds(withCreator);

    const rows = await creatorRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.["emailVerified"]).toBe(false);
    expect(rolesOf(rows[0]?.["roles"]) ?? []).toEqual([]);
    const memberships = await selectMany(stack.db, tenantMembershipsTable, {
      userId: rows[0]?.["id"] as string,
      tenantId: TENANT_ID,
    });
    expect(memberships).toHaveLength(0);
    // The credentials still check out, the account just gained no access: the
    // refusal is about membership, not about a changed password.
    const res = await login(ownPassword);
    expect((await res.json()).error.details.reason).toBe("no_membership");
  });

  test("without the env var no account is seeded", async () => {
    await bootSeeds({});

    expect(await selectMany(stack.db, userTable)).toHaveLength(0);
  });
});
