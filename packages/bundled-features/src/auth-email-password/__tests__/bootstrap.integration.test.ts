// Passwordless bootstrap end to end through the real HTTP routes:
// bootstrapTenants → invite mail (in-memory transport) → accept → login,
// SystemAdmin role only after accept and never usable in a foreign tenant,
// idempotent re-runs, and the security negatives around the system-only
// invite variant (a TenantAdmin can never hand out global roles).

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { configurePiiSubjectKms, InMemoryKmsAdapter } from "@cosmicdrift/kumiko-framework/crypto";
import { asRawClient, selectMany } from "@cosmicdrift/kumiko-framework/db";
import {
  access,
  ConfigScopes,
  createTenantConfig,
  defineFeature,
  type SessionUser,
  type TenantId,
  type WriteResult,
} from "@cosmicdrift/kumiko-framework/engine";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { parseRoles } from "@cosmicdrift/kumiko-framework/utils";
import {
  createTestEnvelopeCipher,
  getSetCookieValue,
  resetPiiSubjectKmsForTests,
} from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import { createChannelEmailFeature, createInMemoryTransport } from "../../channel-email/index.ts";
import { ConfigHandlers } from "../../config/constants.ts";
import { createConfigFeature } from "../../config/index.ts";
import { createConfigResolver } from "../../config/resolver.ts";
import { configValuesTable } from "../../config/table.ts";
import { createDeliveryFeature, createDeliveryTestContext } from "../../delivery/index.ts";
import { notificationPreferencesTable } from "../../delivery/tables.ts";
import { createTenantFeature, TenantQueries } from "../../tenant/index.ts";
import { tenantInvitationEntity, tenantInvitationsTable } from "../../tenant/invitation-table.ts";
import { tenantMembershipsTable } from "../../tenant/membership-table.ts";
import { tenantEntity, tenantTable } from "../../tenant/schema/tenant.ts";
import { seedTenant } from "../../tenant/seeding.ts";
import { createUserFeature } from "../../user/feature.ts";
import { userEntity, userTable } from "../../user/schema/user.ts";
import {
  type BootstrapPlan,
  BootstrapPlanError,
  type BootstrapReport,
  BootstrapWriteError,
  bootstrapTenants,
} from "../bootstrap.ts";
import { AuthHandlers, AuthQueries } from "../constants.ts";
import { createAuthEmailPasswordFeature } from "../feature.ts";
import { invalidateExistingInviteToken } from "../invite-token-store.ts";
import { authMailRendererFeatures, seedAuthMailTemplates } from "./auth-mail-stack.ts";

const APP_ACCEPT_URL = "https://app.example.com/invite/accept";
const ROOT_EMAIL = "root@example.com";
const ROOT_PASSWORD = "root-new-pw-1234";
const CAROL_EMAIL = "carol@example.com";
const CAROL_PASSWORD = "carol-new-pw-1234";
const MALLORY_EMAIL = "mallory@example.com";

const emailTransport = createInMemoryTransport();

const GREETING_KEY = "bootstrap-probe:config:greeting";
const LOCKED_KEY = "bootstrap-probe:config:locked";
const TENANT_ROLE_KEY = "bootstrap-probe:config:tenant-role-only";
const PII_NOTE_KEY = "bootstrap-probe:config:pii-note";
const ENCRYPTED_NOTE_KEY = "bootstrap-probe:config:encrypted-note";
const TENANT_ROLE = "TenantAdmin";
const configCipher = createTestEnvelopeCipher(randomBytes(32).toString("base64"));

// One key with the default tenant write access (admin roles), one that only
// the system may write — bootstrap config has to reach both.
const configProbeFeature = defineFeature("bootstrap-probe", (r) => {
  r.config("greeting", createTenantConfig("text", { default: "hello" }));
  r.config(
    "locked",
    createTenantConfig("select", {
      default: "optional",
      options: ["optional", "admins", "all"],
      write: access.system,
    }),
  );
  // Gated on a tenant role without SystemAdmin, like an app that keeps
  // SystemAdmin out of tenant data.
  r.config("pii-note", createTenantConfig("text", { default: "", piiEncrypted: true }));
  r.config("encrypted-note", createTenantConfig("text", { default: "", encrypted: true }));
  r.config(
    "tenant-role-only",
    createTenantConfig("text", { default: "", write: access.roles(TENANT_ROLE) }),
  );
});

let stack: TestStack;
let tenantAId: TenantId;
let tenantBId: TenantId;
let seededTenantIds: TenantId[];

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createUserFeature(),
      createTenantFeature(),
      configProbeFeature,
      ...authMailRendererFeatures(),
      createDeliveryFeature(),
      createChannelEmailFeature({
        transport: emailTransport,
        resolveEmail: async () => "unused@test.local",
      }),
      createAuthEmailPasswordFeature({
        invite: { tokenTtlMinutes: 60, appUrl: APP_ACCEPT_URL },
      }),
    ],
    extraContext: (deps) => ({
      ...createDeliveryTestContext(deps),
      configResolver: createConfigResolver({ cipher: configCipher }),
      configEncryption: configCipher,
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
  });

  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafeCreateEntityTable(stack.db, tenantEntity);
  await unsafeCreateEntityTable(stack.db, tenantInvitationEntity);
  await unsafePushTables(stack.db, {
    configValuesTable,
    tenantMembershipsTable,
    notificationPreferencesTable,
  });
  await seedAuthMailTemplates(stack);
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await asRawClient(stack.db).unsafe(`DELETE FROM "${userTable.tableName}"`);
  await asRawClient(stack.db).unsafe(`DELETE FROM "${tenantMembershipsTable.tableName}"`);
  await asRawClient(stack.db).unsafe(`DELETE FROM "${tenantInvitationsTable.tableName}"`);
  await asRawClient(stack.db).unsafe(`DELETE FROM "${tenantTable.tableName}"`);
  emailTransport.sent.length = 0;
  await stack.redis.flushNamespace();
  // Fresh ids per test: tenant streams survive the DELETEs above.
  tenantAId = crypto.randomUUID() as TenantId;
  tenantBId = crypto.randomUUID() as TenantId;
  seededTenantIds = [];
});

function launchPlan(): BootstrapPlan {
  return {
    tenants: [
      {
        id: tenantAId,
        key: `acme-${tenantAId.slice(0, 8)}`,
        name: "Acme",
        invites: [{ email: CAROL_EMAIL, role: "Editor" }],
      },
      { id: tenantBId, key: `globex-${tenantBId.slice(0, 8)}`, name: "Globex" },
    ],
    systemAdmins: [{ email: ROOT_EMAIL, tenantId: tenantAId, role: "TenantAdmin" }],
    seed: async ({ tenantId }) => {
      seededTenantIds.push(tenantId);
    },
  };
}

function runBootstrapPlan(plan: BootstrapPlan): Promise<BootstrapReport> {
  return bootstrapTenants(
    {
      db: stack.db,
      redis: stack.redis.redis,
      dispatcher: stack.dispatcher,
      registry: stack.registry,
      configCipher,
    },
    plan,
  );
}

function inviteOutcomes(report: BootstrapReport): Record<string, string> {
  return Object.fromEntries(report.invites.map((i) => [i.email, i.outcome]));
}

function tokenFromLastMailTo(email: string): string {
  const mail = emailTransport.sent.filter((m) => m.to === email).at(-1);
  if (!mail) throw new Error(`no invite mail to ${email}`);
  const match = (mail.text ?? "").match(/[?&]token=([^&"'<\s\]]+)/);
  if (!match?.[1]) throw new Error(`no token in mail to ${email}`);
  return decodeURIComponent(match[1]);
}

async function acceptAsNewUser(email: string, password: string): Promise<void> {
  const res = await stack.http.raw("POST", "/api/auth/invite-signup-complete", {
    token: tokenFromLastMailTo(email),
    password,
  });
  expect(res.status).toBe(200);
}

async function globalRolesOf(email: string): Promise<string[]> {
  const [row] = await selectMany(stack.db, userTable, { email });
  if (!row) throw new Error(`no user ${email}`);
  return parseRoles(row["roles"]);
}

async function loginCookies(email: string, password: string): Promise<Record<string, string>> {
  const res = await stack.http.raw("POST", "/api/auth/login", { email, password });
  expect(res.status).toBe(200);
  const auth = getSetCookieValue(res, "kumiko_auth");
  const csrf = getSetCookieValue(res, "kumiko_csrf");
  if (!auth || !csrf) throw new Error("login set no session cookies");
  return { Cookie: `kumiko_auth=${auth}; kumiko_csrf=${csrf}`, "X-CSRF-Token": csrf };
}

function tenantAdminOfA(): SessionUser {
  return { id: crypto.randomUUID(), tenantId: tenantAId, roles: ["TenantAdmin"] };
}

async function storedConfig(tenantId: TenantId, key: string): Promise<string | undefined> {
  const [row] = await selectMany(stack.db, configValuesTable, { key, tenantId });
  return row?.value ?? undefined;
}

describe("bootstrapTenants", () => {
  test("tenant config is applied on every run, reaches system-only keys, and a matching rerun writes nothing", async () => {
    const plan = (greeting: string): BootstrapPlan => ({
      tenants: [
        {
          id: tenantAId,
          key: `acme-${tenantAId.slice(0, 8)}`,
          name: "Acme",
          config: { [GREETING_KEY]: greeting, [LOCKED_KEY]: "admins" },
        },
      ],
    });

    const first = await runBootstrapPlan(plan("hi"));
    expect(first.tenants[0]?.configApplied).toEqual([GREETING_KEY, LOCKED_KEY]);
    expect(await storedConfig(tenantAId, GREETING_KEY)).toBe(JSON.stringify("hi"));
    expect(await storedConfig(tenantAId, LOCKED_KEY)).toBe(JSON.stringify("admins"));

    const rerun = await runBootstrapPlan(plan("hi"));
    expect(rerun.tenants[0]).toEqual({
      id: tenantAId,
      outcome: "exists",
      seeded: false,
      configApplied: [],
    });

    // Declarative: an edited plan converges an existing tenant, only the changed key is written.
    const changed = await runBootstrapPlan(plan("servus"));
    expect(changed.tenants[0]?.configApplied).toEqual([GREETING_KEY]);
    expect(await storedConfig(tenantAId, GREETING_KEY)).toBe(JSON.stringify("servus"));
  });

  test("encrypted and piiEncrypted keys compare by plaintext: a matching rerun rewrites nothing", async () => {
    const plan = (note: string): BootstrapPlan => ({
      tenants: [
        {
          id: tenantAId,
          key: `acme-${tenantAId.slice(0, 8)}`,
          name: "Acme",
          config: { [PII_NOTE_KEY]: note, [ENCRYPTED_NOTE_KEY]: note },
        },
      ],
    });
    const configEventCount = async (): Promise<number> =>
      (await selectMany(stack.db, eventsTable, { aggregateType: "config-value" })).length;

    // Scoped to this test: a configured subject KMS also encrypts user emails, which
    // the other tests look up in plaintext.
    configurePiiSubjectKms(new InMemoryKmsAdapter());
    try {
      const first = await runBootstrapPlan(plan("alpha"));
      expect(first.tenants[0]?.configApplied).toEqual([PII_NOTE_KEY, ENCRYPTED_NOTE_KEY]);
      const storedBefore = [
        await storedConfig(tenantAId, PII_NOTE_KEY),
        await storedConfig(tenantAId, ENCRYPTED_NOTE_KEY),
      ];
      const eventsBefore = await configEventCount();

      const rerun = await runBootstrapPlan(plan("alpha"));
      expect(rerun.tenants[0]?.configApplied).toEqual([]);
      expect(await configEventCount()).toBe(eventsBefore);
      expect([
        await storedConfig(tenantAId, PII_NOTE_KEY),
        await storedConfig(tenantAId, ENCRYPTED_NOTE_KEY),
      ]).toEqual(storedBefore);

      const changed = await runBootstrapPlan(plan("beta"));
      expect(changed.tenants[0]?.configApplied).toEqual([PII_NOTE_KEY, ENCRYPTED_NOTE_KEY]);
    } finally {
      resetPiiSubjectKmsForTests();
    }
  });

  test("a config value the key rejects fails the run with a BootstrapWriteError", async () => {
    await expect(
      runBootstrapPlan({
        tenants: [
          {
            id: tenantAId,
            key: `acme-${tenantAId.slice(0, 8)}`,
            name: "Acme",
            config: { [LOCKED_KEY]: "nonsense" },
          },
        ],
      }),
    ).rejects.toThrow(BootstrapWriteError);
  });

  test("bootstrap → mail → accept → login; SystemAdmin only after accept and only in its own tenant; second run is a no-op", async () => {
    const first = await runBootstrapPlan(launchPlan());

    expect(first.tenants).toEqual([
      { id: tenantAId, outcome: "created", seeded: true, configApplied: [] },
      { id: tenantBId, outcome: "created", seeded: true, configApplied: [] },
    ]);
    expect(seededTenantIds).toEqual([tenantAId, tenantBId]);
    expect(inviteOutcomes(first)).toEqual({ [ROOT_EMAIL]: "invited", [CAROL_EMAIL]: "invited" });
    expect(emailTransport.sent.map((m) => m.to).sort()).toEqual([CAROL_EMAIL, ROOT_EMAIL]);
    // Nothing granted before accept: no user row exists yet.
    expect(await selectMany(stack.db, userTable, { email: ROOT_EMAIL })).toHaveLength(0);

    await acceptAsNewUser(ROOT_EMAIL, ROOT_PASSWORD);
    await acceptAsNewUser(CAROL_EMAIL, CAROL_PASSWORD);
    expect(await globalRolesOf(ROOT_EMAIL)).toEqual(["SystemAdmin"]);
    expect(await globalRolesOf(CAROL_EMAIL)).toEqual([]);

    // Positive control: the accepted SystemAdmin really holds the role…
    const rootHeaders = await loginCookies(ROOT_EMAIL, ROOT_PASSWORD);
    const listRes = await stack.http.raw(
      "POST",
      "/api/query",
      { type: TenantQueries.list, payload: {} },
      rootHeaders,
    );
    expect(listRes.status).toBe(200);
    // …while the plain invitee does not.
    const carolHeaders = await loginCookies(CAROL_EMAIL, CAROL_PASSWORD);
    const carolListRes = await stack.http.raw(
      "POST",
      "/api/query",
      { type: TenantQueries.list, payload: {} },
      carolHeaders,
    );
    expect(carolListRes.status).toBe(403);

    // The global role opens no foreign tenant: no membership in B → 403.
    const switchRes = await stack.http.raw(
      "POST",
      "/api/auth/switch-tenant",
      { tenantId: tenantBId },
      rootHeaders,
    );
    expect(switchRes.status).toBe(403);

    const mailsBeforeRerun = emailTransport.sent.length;
    const second = await runBootstrapPlan(launchPlan());
    expect(second.tenants).toEqual([
      { id: tenantAId, outcome: "exists", seeded: false, configApplied: [] },
      { id: tenantBId, outcome: "exists", seeded: false, configApplied: [] },
    ]);
    expect(seededTenantIds).toEqual([tenantAId, tenantBId]);
    expect(inviteOutcomes(second)).toEqual({ [ROOT_EMAIL]: "active", [CAROL_EMAIL]: "active" });
    expect(emailTransport.sent).toHaveLength(mailsBeforeRerun);
    expect(await selectMany(stack.db, tenantInvitationsTable, { email: ROOT_EMAIL })).toHaveLength(
      1,
    );
  });

  test("a pending invitation is not re-sent; one that expired unused is re-sent with a working link", async () => {
    await runBootstrapPlan(launchPlan());
    expect(emailTransport.sent).toHaveLength(2);

    const rerun = await runBootstrapPlan(launchPlan());
    expect(inviteOutcomes(rerun)).toEqual({ [ROOT_EMAIL]: "pending", [CAROL_EMAIL]: "pending" });
    expect(emailTransport.sent).toHaveLength(2);

    const [rootInvitation] = await selectMany(stack.db, tenantInvitationsTable, {
      email: ROOT_EMAIL,
    });
    if (!rootInvitation) throw new Error("no root invitation");
    // Token TTL ran out in Redis — the only source of truth for expiry.
    await invalidateExistingInviteToken(stack.redis.redis, String(rootInvitation["id"]));

    const afterExpiry = await runBootstrapPlan(launchPlan());
    expect(inviteOutcomes(afterExpiry)).toEqual({
      [ROOT_EMAIL]: "resent",
      [CAROL_EMAIL]: "pending",
    });
    expect(emailTransport.sent).toHaveLength(3);
    await acceptAsNewUser(ROOT_EMAIL, ROOT_PASSWORD);
    expect(await globalRolesOf(ROOT_EMAIL)).toEqual(["SystemAdmin"]);
  });

  test("seed writes with app tenant roles via dispatchWriteAs; dispatchSystemWrite (SystemAdmin) is denied", async () => {
    const writeArgs = {
      handlerQn: ConfigHandlers.set,
      payload: { key: TENANT_ROLE_KEY, value: "seeded", scope: ConfigScopes.tenant },
    };
    const results: { viaRoles: WriteResult; viaSystemAdmin: WriteResult }[] = [];
    await runBootstrapPlan({
      tenants: [{ id: tenantAId, key: `acme-${tenantAId.slice(0, 8)}`, name: "Acme" }],
      seed: async ({ tenantId, dispatchWriteAs, dispatchSystemWrite }) => {
        results.push({
          viaSystemAdmin: await dispatchSystemWrite({ ...writeArgs, tenantId }),
          viaRoles: await dispatchWriteAs({ ...writeArgs, roles: [TENANT_ROLE] }),
        });
      },
    });

    const [result] = results;
    expect(result?.viaSystemAdmin.isSuccess).toBe(false);
    if (result?.viaSystemAdmin.isSuccess === false) {
      expect(result.viaSystemAdmin.error.code).toBe("access_denied");
    }
    expect(result?.viaRoles.isSuccess).toBe(true);
    const rows = await selectMany(stack.db, configValuesTable, { tenantId: tenantAId });
    expect(rows.map((r) => r.value)).toEqual([JSON.stringify("seeded")]);
  });

  test("an existing tenant is left alone and never seeded", async () => {
    await seedTenant(stack.db, { id: tenantAId, key: `acme-${tenantAId.slice(0, 8)}`, name: "A" });
    const report = await runBootstrapPlan(launchPlan());
    expect(report.tenants[0]).toEqual({
      id: tenantAId,
      outcome: "exists",
      seeded: false,
      configApplied: [],
    });
    expect(seededTenantIds).toEqual([tenantBId]);
  });

  test("rejects a plan that lists one email twice for a tenant, or a SystemAdmin in an unlisted tenant", async () => {
    const plan = launchPlan();
    await expect(
      runBootstrapPlan({
        ...plan,
        systemAdmins: [{ email: "Carol@Example.com", tenantId: tenantAId, role: "TenantAdmin" }],
      }),
    ).rejects.toBeInstanceOf(BootstrapPlanError);
    await expect(
      runBootstrapPlan({
        ...plan,
        systemAdmins: [
          { email: ROOT_EMAIL, tenantId: crypto.randomUUID() as TenantId, role: "TenantAdmin" },
        ],
      }),
    ).rejects.toBeInstanceOf(BootstrapPlanError);
    expect(await selectMany(stack.db, tenantTable, { id: tenantAId })).toHaveLength(0);
    expect(emailTransport.sent).toHaveLength(0);
  });
});

describe("global roles can only come from the system-only invite", () => {
  test("a TenantAdmin calling system-invite-create over HTTP is rejected with 403", async () => {
    await seedTenant(stack.db, { id: tenantAId, key: `acme-${tenantAId.slice(0, 8)}`, name: "A" });
    const err = await stack.http.writeErr(
      AuthHandlers.systemInviteCreate,
      { email: MALLORY_EMAIL, role: "User", globalRoles: ["SystemAdmin"] },
      tenantAdminOfA(),
    );
    expect(err.httpStatus).toBe(403);
    expect(await selectMany(stack.db, tenantInvitationsTable, { email: MALLORY_EMAIL })).toEqual(
      [],
    );
    expect(emailTransport.sent).toHaveLength(0);
  });

  test("a real SystemAdmin session cannot call system-invite-create either (403)", async () => {
    await seedTenant(stack.db, { id: tenantAId, key: `acme-${tenantAId.slice(0, 8)}`, name: "A" });
    const err = await stack.http.writeErr(
      AuthHandlers.systemInviteCreate,
      { email: MALLORY_EMAIL, role: "User", globalRoles: ["SystemAdmin"] },
      { id: crypto.randomUUID(), tenantId: tenantAId, roles: ["SystemAdmin", "TenantAdmin"] },
    );
    expect(err.httpStatus).toBe(403);
    expect(emailTransport.sent).toHaveLength(0);
  });

  test("invite-create ignores a smuggled globalRoles field — the invitee gets no global role", async () => {
    await seedTenant(stack.db, { id: tenantAId, key: `acme-${tenantAId.slice(0, 8)}`, name: "A" });
    await stack.http.raw(
      "POST",
      "/api/write",
      {
        type: AuthHandlers.inviteCreate,
        payload: { email: MALLORY_EMAIL, role: "User", globalRoles: ["SystemAdmin"] },
      },
      { Authorization: `Bearer ${await stack.jwt.sign(tenantAdminOfA())}` },
    );
    const [invitation] = await selectMany(stack.db, tenantInvitationsTable, {
      email: MALLORY_EMAIL,
    });
    expect(invitation).toBeDefined();
    expect(parseRoles(invitation?.["globalRoles"])).toEqual([]);
    await acceptAsNewUser(MALLORY_EMAIL, "mallory-new-pw-1234");
    expect(await globalRolesOf(MALLORY_EMAIL)).toEqual([]);
  });

  test("a TenantAdmin re-inviting the email of a pending SystemAdmin invitation drops the global role; bootstrap reports it instead of restoring it", async () => {
    await runBootstrapPlan(launchPlan());
    const [before] = await selectMany(stack.db, tenantInvitationsTable, { email: ROOT_EMAIL });
    expect(parseRoles(before?.["globalRoles"])).toEqual(["SystemAdmin"]);

    await stack.http.writeOk(
      AuthHandlers.inviteCreate,
      { email: ROOT_EMAIL, role: "User" },
      tenantAdminOfA(),
    );
    const [after] = await selectMany(stack.db, tenantInvitationsTable, { email: ROOT_EMAIL });
    expect(parseRoles(after?.["globalRoles"])).toEqual([]);

    const mailsBeforeRerun = emailTransport.sent.length;
    const rerunWhilePending = await runBootstrapPlan(launchPlan());
    expect(inviteOutcomes(rerunWhilePending)[ROOT_EMAIL]).toBe("role-mismatch");

    await acceptAsNewUser(ROOT_EMAIL, ROOT_PASSWORD);
    expect(await globalRolesOf(ROOT_EMAIL)).toEqual([]);

    const rerunAfterAccept = await runBootstrapPlan(launchPlan());
    expect(inviteOutcomes(rerunAfterAccept)[ROOT_EMAIL]).toBe("role-mismatch");
    expect(emailTransport.sent).toHaveLength(mailsBeforeRerun);
  });

  test("an address moved from systemAdmins to tenants[].invites gets its invitation re-issued without SystemAdmin", async () => {
    await runBootstrapPlan(launchPlan());
    const staleToken = tokenFromLastMailTo(ROOT_EMAIL);
    const mailsBefore = emailTransport.sent.length;

    const demoted = launchPlan();
    const rerun = await runBootstrapPlan({
      ...demoted,
      systemAdmins: [],
      tenants: demoted.tenants.map((tenant) =>
        tenant.id === tenantAId
          ? {
              ...tenant,
              invites: [...(tenant.invites ?? []), { email: ROOT_EMAIL, role: "TenantAdmin" }],
            }
          : tenant,
      ),
    });
    expect(inviteOutcomes(rerun)[ROOT_EMAIL]).toBe("resent");
    expect(emailTransport.sent).toHaveLength(mailsBefore + 1);
    const [invitation] = await selectMany(stack.db, tenantInvitationsTable, { email: ROOT_EMAIL });
    expect(parseRoles(invitation?.["globalRoles"])).toEqual([]);

    const staleRes = await stack.http.raw("POST", "/api/auth/invite-signup-complete", {
      token: staleToken,
      password: ROOT_PASSWORD,
    });
    expect(staleRes.status).not.toBe(200);

    await acceptAsNewUser(ROOT_EMAIL, ROOT_PASSWORD);
    expect(await globalRolesOf(ROOT_EMAIL)).toEqual([]);
  });
});
