// The creator of a freshly scaffolded app is seeded as admin WITHOUT a password and sets one
// through the real password-reset flow.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import {
  AuthHandlers,
  createAuthEmailPasswordFeature,
} from "@cosmicdrift/kumiko-bundled-features/auth-email-password";
import {
  seedTenant,
  seedTenantMembership,
  seedUser,
  seedUserWithPassword,
} from "@cosmicdrift/kumiko-bundled-features/auth-email-password/seeding";
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
import { createRendererMailHtmlFeature } from "@cosmicdrift/kumiko-bundled-features/renderer-mail-html";
import { createTemplateResolverFeature } from "@cosmicdrift/kumiko-bundled-features/template-resolver";
import {
  createTenantFeature,
  TenantHandlers,
  tenantMembershipsTable,
} from "@cosmicdrift/kumiko-bundled-features/tenant";
import { createUserFeature, userTable } from "@cosmicdrift/kumiko-bundled-features/user";
import { ROLES } from "@cosmicdrift/kumiko-framework/auth";
import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import { createAnonymousUser, createSystemUser } from "@cosmicdrift/kumiko-framework/engine";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { registerMailTranslations } from "@cosmicdrift/kumiko-framework/i18n";
import { createTestUser } from "@cosmicdrift/kumiko-framework/seeding";
import { localeDeBundle } from "@cosmicdrift/kumiko-locale-de";
import { resetTestTables } from "@cosmicdrift/kumiko-testing/helpers";
import { setupTestStack, type TestStack } from "@cosmicdrift/kumiko-testing/stack";
import type { TenantId } from "@cosmicdrift/kumiko-types/identifiers";
import { resolveSeedShortcuts } from "../../boot-options/seed-shortcuts.ts";
import { applyStandardBootSeeds, runSeedFollowUps } from "../shared-boot-steps.ts";

registerMailTranslations("de", localeDeBundle);

const TENANT_ID = "00000000-0000-4000-8000-0000000000b1" as TenantId;
const CREATOR_EMAIL = "creator@example.com";
const FOREIGN_ACTOR_ID = "00000000-0000-4000-8000-0000000000f1";
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

async function bootSeeds(
  envSource: Record<string, string | undefined>,
  options: {
    readonly roles?: readonly string[];
    readonly ensureRoles?: boolean;
    readonly sendSetPasswordMail?: boolean;
    readonly target?: TestStack;
  } = {},
) {
  const { target = stack, ...seedOptions } = options;
  const { followUps } = await applyStandardBootSeeds({
    db: target.db,
    registry: target.registry,
    admin: undefined,
    shortcutSeeds: resolveSeedShortcuts(
      {
        bootstrapAdminFromEnv: {
          tenant: { id: TENANT_ID, key: "app", name: "App" },
          ...seedOptions,
        },
      },
      { envSource, hasAuth: true, hasAuthAdmin: false },
    ),
    cipher: undefined,
    processName: "test",
  });
  await runSeedFollowUps(followUps, { dispatcher: target.dispatcher, registry: target.registry });
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
    const token = mail?.text?.match(/\?token=([^&\s\]]+)/)?.[1];
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
      ?.text?.match(/\?token=([^&\s\]]+)/)?.[1];
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

  test("a tenant that already has another member gets no new bootstrap account", async () => {
    await seedTenant(stack.db, { id: TENANT_ID, key: "app", name: "App" });
    const { id: renamedOwnerId } = await seedUserWithPassword(stack.db, {
      email: "owner-with-new-email@example.com",
      password: "owner-password-12345",
      displayName: "Owner",
    });
    await seedTenantMembership(stack.db, {
      userId: renamedOwnerId,
      tenantId: TENANT_ID,
      roles: ["Admin", ROLES.TenantAdmin],
    });

    await bootSeeds(withCreator);

    expect(await creatorRows()).toHaveLength(0);
    const members = await selectMany(stack.db, tenantMembershipsTable, { tenantId: TENANT_ID });
    expect(members).toHaveLength(1);
  });

  test("a partial earlier seed (account without membership) is completed", async () => {
    const { id: partialId } = await seedUser(stack.db, {
      email: CREATOR_EMAIL,
      displayName: "Admin",
    });

    await bootSeeds(withCreator);

    const rows = await creatorRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.["id"]).toBe(partialId);
    const memberships = await selectMany(stack.db, tenantMembershipsTable, {
      userId: partialId,
      tenantId: TENANT_ID,
    });
    expect(memberships).toHaveLength(1);
    expect(rolesOf(memberships[0]?.["roles"])).toEqual(["Admin", ROLES.TenantAdmin]);
  });

  test("without the env var no account is seeded", async () => {
    await bootSeeds({});

    expect(await selectMany(stack.db, userTable)).toHaveLength(0);
  });
});

describe("bootstrap admin set-password mail", () => {
  const creatorMails = () => emailTransport.sent.filter((sent) => sent.to === CREATOR_EMAIL);

  test("a newly created owner gets one reset mail whose link sets the password", async () => {
    await bootSeeds(withCreator, { sendSetPasswordMail: true });

    expect(creatorMails()).toHaveLength(1);
    const text = creatorMails()[0]?.text ?? "";
    expect(creatorMails()[0]?.subject).toContain("set your password");
    expect(text).toContain(APP_RESET_URL);
    const token = text.match(/\?token=([^&\s\]]+)/)?.[1];
    if (token === undefined) throw new Error("reset mail with token missing");
    const reset = await stack.http.raw("POST", "/api/auth/reset-password", {
      token: decodeURIComponent(token),
      newPassword: NEW_PASSWORD,
    });
    expect(reset.status).toBe(200);
    expect((await login(NEW_PASSWORD)).status).toBe(200);
  });

  test("the link stays valid for 72 hours, not for the reset flow's 15 minutes", async () => {
    await bootSeeds(withCreator, { sendSetPasswordMail: true });

    const token = creatorMails()[0]?.text?.match(/\?token=([^&\s\]]+)/)?.[1];
    if (token === undefined) throw new Error("set-password mail with token missing");
    const expiresAtMs = Number(decodeURIComponent(token).split(".")[1]);
    const expectedMs = Date.now() + 72 * 60 * 60 * 1000;
    expect(Math.abs(expiresAtMs - expectedMs)).toBeLessThan(5 * 60 * 1000);
  });

  test("a retried seed function in the same process still yields the follow-up", async () => {
    const [seed] = resolveSeedShortcuts(
      {
        bootstrapAdminFromEnv: {
          tenant: { id: TENANT_ID, key: "app", name: "App" },
          sendSetPasswordMail: true,
        },
      },
      { envSource: withCreator, hasAuth: true, hasAuthAdmin: false },
    );
    if (seed === undefined) throw new Error("bootstrap seed missing");

    expect(typeof (await seed(stack.db))).toBe("function");
    expect(typeof (await seed(stack.db))).toBe("function");

    const [freshProcessSeed] = resolveSeedShortcuts(
      {
        bootstrapAdminFromEnv: {
          tenant: { id: TENANT_ID, key: "app", name: "App" },
          sendSetPasswordMail: true,
        },
      },
      { envSource: withCreator, hasAuth: true, hasAuthAdmin: false },
    );
    expect(await freshProcessSeed?.(stack.db)).toBeUndefined();
  });

  test("an anonymous caller cannot request the long-lived set-password link", async () => {
    await bootSeeds(withCreator);

    const result = await stack.dispatcher.write(
      AuthHandlers.requestInitialPassword,
      { email: CREATOR_EMAIL },
      createAnonymousUser(TENANT_ID),
    );

    expect(result.isSuccess).toBe(false);
    expect(creatorMails()).toHaveLength(0);
  });

  test("a second boot with the same owner sends no second mail", async () => {
    await bootSeeds(withCreator, { sendSetPasswordMail: true });
    await bootSeeds(withCreator, { sendSetPasswordMail: true });

    expect(creatorMails()).toHaveLength(1);
  });

  test("without a password-reset flow the boot succeeds and no mail goes out", async () => {
    const withoutMail = await setupTestStack({
      features: [
        createConfigFeature(),
        createUserFeature(),
        createTenantFeature(),
        createTemplateResolverFeature(),
        createRendererFoundationFeature(),
        createRendererMailHtmlFeature(),
        createDeliveryFeature(),
        createAuthEmailPasswordFeature({}),
      ],
      authConfig: {
        membershipQuery: "tenant:query:memberships",
        loginHandler: AuthHandlers.login,
      },
    });
    try {
      await bootSeeds(withCreator, { sendSetPasswordMail: true, target: withoutMail });

      expect(await selectMany(withoutMail.db, userTable, { email: CREATOR_EMAIL })).toHaveLength(1);
      expect(creatorMails()).toHaveLength(0);
    } finally {
      await withoutMail.cleanup();
    }
  });

  test("without the option no mail goes out", async () => {
    await bootSeeds(withCreator);

    expect(await creatorRows()).toHaveLength(1);
    expect(creatorMails()).toHaveLength(0);
  });
});

describe("bootstrap admin ensureRoles", () => {
  async function membershipRoles(): Promise<unknown> {
    const [user] = await creatorRows();
    const memberships = await selectMany(stack.db, tenantMembershipsTable, {
      userId: user?.["id"] as string,
      tenantId: TENANT_ID,
    });
    return rolesOf(memberships[0]?.["roles"]);
  }

  async function membershipEventCount(): Promise<number> {
    const events = await selectMany(stack.db, eventsTable, {});
    return events.filter((event) => String(event["type"]).startsWith("tenantMembership")).length;
  }

  test("a later boot with an extra role adds it and keeps the existing ones", async () => {
    await bootSeeds(withCreator, { roles: ["Admin"] });

    await bootSeeds(withCreator, { roles: ["Admin", "Editor"], ensureRoles: true });

    expect(await membershipRoles()).toEqual(["Admin", "Editor"]);
  });

  test("without ensureRoles the existing membership keeps its roles", async () => {
    await bootSeeds(withCreator, { roles: ["Admin"] });

    await bootSeeds(withCreator, { roles: ["Admin", "Editor"] });

    expect(await membershipRoles()).toEqual(["Admin"]);
  });

  test("ensureRoles never removes roles and writes no event when nothing is missing", async () => {
    await bootSeeds(withCreator, { roles: ["Admin", "Editor"] });
    const before = await membershipEventCount();

    await bootSeeds(withCreator, { roles: ["Admin"], ensureRoles: true });

    expect(await membershipRoles()).toEqual(["Admin", "Editor"]);
    expect(await membershipEventCount()).toBe(before);
  });

  test("ensureRoles also tops up after the owner has set a password", async () => {
    await bootSeeds(withCreator, { roles: ["Admin"] });
    await stack.http.raw("POST", "/api/auth/request-password-reset", { email: CREATOR_EMAIL });
    const token = emailTransport.sent
      .find((sent) => sent.to === CREATOR_EMAIL)
      ?.text?.match(/\?token=([^&\s\]]+)/)?.[1];
    if (token === undefined) throw new Error("reset mail with token missing");
    await stack.http.raw("POST", "/api/auth/reset-password", {
      token: decodeURIComponent(token),
      newPassword: NEW_PASSWORD,
    });

    await bootSeeds(withCreator, { roles: ["Admin", "Editor"], ensureRoles: true });

    expect(await membershipRoles()).toEqual(["Admin", "Editor"]);
  });

  test("ensureRoles never escalates a membership the bootstrap seed did not create", async () => {
    await seedTenant(stack.db, { id: TENANT_ID, key: "app", name: "App" });
    const { id: userId } = await seedUser(stack.db, {
      email: CREATOR_EMAIL,
      displayName: "Same mail, other origin",
    });
    await seedTenantMembership(stack.db, {
      userId,
      tenantId: TENANT_ID,
      roles: ["Member"],
      by: { ...createSystemUser(TENANT_ID), id: FOREIGN_ACTOR_ID },
    });

    await bootSeeds(withCreator, { roles: ["Admin"], ensureRoles: true });

    expect(await membershipRoles()).toEqual(["Member"]);
  });

  test("ensureRoles never reverts a role change a human made through the handler", async () => {
    await bootSeeds(withCreator, { roles: ["Admin"] });
    const [owner] = await creatorRows();
    const admin = createTestUser({ id: 7, tenantId: TENANT_ID, roles: [ROLES.SystemAdmin] });
    await stack.http.writeOk(
      TenantHandlers.updateMemberRoles,
      { userId: owner?.["id"] as string, tenantId: TENANT_ID, roles: ["Admin"] },
      admin,
    );
    const afterHumanChange = await membershipRoles();

    await bootSeeds(withCreator, { roles: ["Admin", "Editor"], ensureRoles: true });

    expect(await membershipRoles()).toEqual(afterHumanChange);
    expect(await membershipRoles()).not.toContain("Editor");
  });
});
