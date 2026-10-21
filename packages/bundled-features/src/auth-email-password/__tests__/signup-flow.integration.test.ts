// Magic-link self-signup full-stack integration test. The test itself is the
// specification (per the advisor recommendation). It uses HTTP because
// stack.dispatcher is not exposed, and the routes are the actual user path.
//
// Pins:
//   1. POST signup-request with a valid email → 200, with the activation mail
//      sent through delivery (channel-email in-memory transport) containing a
//      token URL.
//   2. Resend: a second request for the same email → a NEW token, and the
//      previous token is invalidated (Redis never stores the raw token as a
//      value, so it cannot be recovered or reused).
//   3. POST signup-confirm with the captured token and password → 200, cookies
//      set (kumiko_auth + kumiko_csrf), a body containing user + tenantKey,
//      and the DB containing the user (emailVerified=true), tenant, and
//      Admin membership.
//   4. POST /api/auth/login with the same password → 200. This proves that
//      the tenant, user, and membership really exist. Although auto-login
//      could instead use the JWT from signup-confirm, this second login rules
//      out the signup-confirm pipeline silently dropping anything.
//   5. Replay: a second signup-confirm with the same token → 422
//      invalid_signup_token (single-use burn).
//   6. Token not found or expired → 422 invalid_signup_token, using a uniform
//      code to prevent enumeration leaks.
//   7. Sequential signups → unique tenantKey slugs (TOCTOU protection from
//      the DB unique index together with the generateUniqueName-
//      isAvailable check).

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { LOCALE_HEADER_NAME } from "@cosmicdrift/kumiko-framework/api";

import { asRawClient, buildEntityTable, selectMany } from "@cosmicdrift/kumiko-framework/db";
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { registerMailTranslations } from "@cosmicdrift/kumiko-framework/i18n";
import { localeDeBundle } from "@cosmicdrift/kumiko-locale-de";
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
import { createTenantFeature } from "../../tenant/index.ts";
import { tenantMembershipsTable } from "../../tenant/membership-table.ts";
import { tenantEntity, tenantTable } from "../../tenant/schema/tenant.ts";
// kumiko-lint-ignore cross-feature-import regression-proof: seedTenant
// must fire tier-engine's entity postSave hook on self-signup, not just on the
// TenantHandlers.create HTTP path.
import { tierAssignmentEntity } from "../../tier-engine/entity.ts";
import { createTierEngineFeature } from "../../tier-engine/feature.ts";
import { createUserFeature } from "../../user/feature.ts";
import { userEntity, userTable } from "../../user/schema/user.ts";
import { createAuthEmailPasswordFeature } from "../feature.ts";
import { AuthErrors, AuthHandlers } from "../web/constants.ts";
import { authMailRendererFeatures, seedAuthMailTemplates } from "./auth-mail-stack.ts";

const tierAssignmentTable = buildEntityTable("tier-assignment", tierAssignmentEntity);

// Regression-proof: provisionSignupAccount only threaded `hooks`
// into seedTenant, leaving seedUserWithPassword's `user`-entity and
// seedTenantMembership's `tenantMembership`-entity postSave hooks unfired
// on self-signup — same bug class as the other issue, just for the other two
// entities in the same call. This vendor feature's hook is the user-side
// analog of tier-engine's tenant hook above.
const userPostSaveFired = { count: 0 };
const userHookVendorFeature = defineFeature("user-hook-vendor-test", (r) => {
  r.requires({ features: ["user"] });
  r.hook({
    type: "postSave",
    target: { allOf: "user" },
    handler: async (ctx) => {
      if (ctx.isNew) userPostSaveFired.count++;
    },
  });
});

// Regression-proof: seedTenantMembership must fire the
// `tenantMembership` entity's postSave hooks (e.g. a Welcome-notification
// hook) on self-signup too — pins the `fireEntityPostSave` call added at
// seeding.ts's seedTenantMembership, not just the `user`/`tenant` ones.
// Also record ctx._tenantId so a shallow-only rescope regresses.
const tenantMembershipPostSaveFired = { count: 0, seenTenantIds: [] as string[] };
const tenantMembershipHookVendorFeature = defineFeature(
  "tenant-membership-hook-vendor-test",
  (r) => {
    r.requires({ features: ["tenant"] });
    r.hook({
      type: "postSave",
      target: { allOf: "tenant-membership" },
      handler: async (result, context) => {
        if (result.isNew) {
          tenantMembershipPostSaveFired.count++;
          if (context._tenantId !== undefined) {
            tenantMembershipPostSaveFired.seenTenantIds.push(String(context._tenantId));
          }
        }
      },
    });
  },
);

const APP_ACTIVATION_URL = "https://app.example.com/signup/complete";

registerMailTranslations("de", localeDeBundle);

// Activation mails now go through delivery (ctx.notify → channel-email). The
// in-memory transport captures what would be sent; route:{email} delivers
// directly (no jobRunner in the test stack → inline send).
const emailTransport = createInMemoryTransport();

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createUserFeature(),
      createTenantFeature(),
      ...authMailRendererFeatures(),
      createDeliveryFeature(),
      createChannelEmailFeature({
        transport: emailTransport,
        // route:{email} delivers directly — resolveEmail (userId→address) is
        // never hit by the signup flow, but the channel requires it.
        resolveEmail: async () => "unused@test.local",
      }),
      createAuthEmailPasswordFeature({
        signup: { tokenTtlMinutes: 60, appUrl: APP_ACTIVATION_URL },
      }),
      // Regression-proof: seedTenant must fire the entity postSave
      // hook on self-signup too, not just on the TenantHandlers.create path.
      createTierEngineFeature({
        defaultTier: "free",
        tierMap: { free: { features: [], caps: {} } },
      }),
      userHookVendorFeature,
      tenantMembershipHookVendorFeature,
    ],
    extraContext: (deps) => ({
      ...createDeliveryTestContext(deps),
      configResolver: createConfigResolver(),
    }),
    authConfig: {
      membershipQuery: "tenant:query:memberships",
      loginHandler: AuthHandlers.login,
      signup: {
        requestHandler: AuthHandlers.signupRequest,
        confirmHandler: AuthHandlers.signupConfirm,
      },
    },
    // signup-request declares rateLimit: { per: "ip+handler", limit: 10 }.
    // Since e7bf543ad, an unset socket address resolves to the shared
    // "unknown" IP rather than skipping the bucket — every postSignupRequest
    // call in this file (14+ across all tests) would otherwise collapse
    // into that one 10/60s bucket and fail later tests with rate_limited,
    // regardless of the test's own scenario. trustedProxyHops: 1 lets
    // postSignupRequest hand each distinct signup its own resolved IP via
    // X-Forwarded-For, mirroring distinct real callers instead of one.
    trustedProxyHops: 1,
  });

  await unsafeCreateEntityTable(stack.db, userEntity);
  // The tenant entity has a unique constraint on .key (see
  // tenant.schema.indexes). unsafeCreateEntityTable builds it through
  // buildEntityTable, pinning the TOCTOU protection for signup-confirm.
  await unsafeCreateEntityTable(stack.db, tenantEntity);
  await unsafePushTables(stack.db, {
    configValuesTable,
    tenantMembershipsTable,
    notificationPreferencesTable,
    tierAssignmentTable,
  });
  await seedAuthMailTemplates(stack);
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await asRawClient(stack.db).unsafe(`DELETE FROM "${userTable.tableName}"`);
  await asRawClient(stack.db).unsafe(`DELETE FROM "${tenantMembershipsTable.tableName}"`);
  await asRawClient(stack.db).unsafe(`DELETE FROM "${tierAssignmentTable.tableName}"`);
  await asRawClient(stack.db).unsafe(`DELETE FROM "${tenantTable.tableName}"`);
  emailTransport.sent.length = 0;
  userPostSaveFired.count = 0;
  tenantMembershipPostSaveFired.count = 0;
  tenantMembershipPostSaveFired.seenTenantIds = [];
  // Clear Redis so resend tests do not leak state.
  const allKeys = await stack.redis.redis.keys("signup:*");
  if (allKeys.length > 0) await stack.redis.redis.del(...allKeys);
});

async function postSignupRequest(
  email: string,
  headers?: Record<string, string>,
): Promise<Response> {
  // Distinct email → distinct resolved IP (trustedProxyHops: 1 above), so
  // each test's own signup-request calls land in their own rate-limit
  // bucket instead of sharing the file-wide "unknown" one.
  return stack.http.raw(
    "POST",
    "/api/auth/signup-request",
    { email },
    { "x-forwarded-for": email, ...headers },
  );
}

async function postSignupConfirm(token: string, password: string): Promise<Response> {
  return stack.http.raw("POST", "/api/auth/signup-confirm", { token, password });
}

async function postLogin(email: string, password: string): Promise<Response> {
  return stack.http.raw("POST", "/api/auth/login", { email, password });
}

function extractTokenFromMail(text: string): string {
  const match = text.match(/[?&]token=([^&"'<\s\]]+)/);
  if (!match?.[1]) throw new Error(`No token in mail text: ${text.slice(0, 200)}`);
  return decodeURIComponent(match[1]);
}

describe("POST /api/auth/signup-request", () => {
  test("known email → 200, delivery sends activation mail with token URL", async () => {
    const res = await postSignupRequest("alice@example.com");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ isSuccess: true });
    expect(emailTransport.sent).toHaveLength(1);
    const sent = emailTransport.sent[0];
    if (!sent) throw new Error("no mail sent");
    expect(sent.to).toBe("alice@example.com");
    expect(sent.text).toContain(`${APP_ACTIVATION_URL}?token=`);
    expect(sent.html).toContain(`${APP_ACTIVATION_URL}?token&#x3D;`);
  });

  test("Resend: second request for the same email mints a new token and invalidates the previous one", async () => {
    await postSignupRequest("resend@example.com");
    await postSignupRequest("resend@example.com");

    expect(emailTransport.sent).toHaveLength(2);
    const [first, second] = emailTransport.sent;
    if (!first || !second) throw new Error("missing mails");
    const firstToken = extractTokenFromMail(first.text ?? "");
    const secondToken = extractTokenFromMail(second.text ?? "");
    expect(secondToken).not.toBe(firstToken);

    // The first mail's link must actually stop working (not just look
    // different) — this is what catches a double-hash bug in invalidation.
    const firstConfirm = await postSignupConfirm(firstToken, "irrelevant-pw-1234");
    expect(firstConfirm.status).toBe(422);
    const firstBody = (await firstConfirm.json()) as { error?: { details?: { reason?: string } } };
    expect(firstBody.error?.details?.reason).toBe(AuthErrors.invalidSignupToken);

    const secondConfirm = await postSignupConfirm(secondToken, "fresh-secure-pw-1234");
    expect(secondConfirm.status).toBe(200);
  });

  test("malformed body → 200 (silent success, anti-enumeration)", async () => {
    const res = await stack.http.raw("POST", "/api/auth/signup-request", { wrong: "shape" });
    expect(res.status).toBe(200);
    expect(emailTransport.sent).toHaveLength(0);
  });
});

describe("POST /api/auth/signup-confirm", () => {
  async function requestSignup(email: string): Promise<string> {
    emailTransport.sent.length = 0;
    const res = await postSignupRequest(email);
    expect(res.status).toBe(200);
    const sent = emailTransport.sent[0];
    if (!sent) throw new Error("signup-request fixture didn't send mail");
    return extractTokenFromMail(sent.text ?? "");
  }

  test("voller Roundtrip: confirm legt user + tenant + Admin-Membership an, Cookies + Login funktioniert", async () => {
    const email = "bob@example.com";
    const password = "fresh-secure-pw-1234";
    const token = await requestSignup(email);

    const confirmRes = await postSignupConfirm(token, password);
    expect(confirmRes.status).toBe(200);
    const body = (await confirmRes.json()) as {
      isSuccess: boolean;
      token?: string;
      user?: { id: string; tenantId: string; roles: string[] };
      tenantKey?: string;
    };
    expect(body.isSuccess).toBe(true);
    expect(body.token).toBeTruthy();
    expect(body.user?.id).toBeTruthy();
    expect(body.user?.tenantId).toBeTruthy();
    expect(body.user?.roles).toContain("TenantAdmin");
    expect(body.tenantKey).toBeTruthy();
    // No auth.postAuthLanding configured on this stack — the field must be
    // absent entirely, not `landingPath: undefined`.
    expect(body).not.toHaveProperty("landingPath");

    // Cookies gesetzt (auth + csrf)
    const setCookies = confirmRes.headers.get("set-cookie") ?? "";
    expect(setCookies).toContain("kumiko_auth=");
    expect(setCookies).toContain("kumiko_csrf=");

    // DB-State pinst
    const userRows = await selectMany(stack.db, userTable, { email: email });
    expect(userRows).toHaveLength(1);
    expect(userRows[0]?.["emailVerified"]).toBe(true);
    expect(userRows[0]?.["passwordHash"]).toBeTruthy();

    const tenantRows = await selectMany(stack.db, tenantTable, { id: body.user?.tenantId ?? "" });
    expect(tenantRows).toHaveLength(1);
    expect(tenantRows[0]?.["key"]).toBe(body.tenantKey);
    expect(tenantRows[0]?.["name"]).toBe(body.tenantKey);
    expect(String(tenantRows[0]?.["name"])).not.toContain(email);

    const memberships = await selectMany(stack.db, tenantMembershipsTable, {
      userId: body.user?.id ?? "",
    });
    expect(memberships).toHaveLength(1);
    const rolesRaw = memberships[0]?.["roles"];
    if (typeof rolesRaw === "string") {
      expect(JSON.parse(rolesRaw) as string[]).toContain("TenantAdmin");
    }

    // Regression: seedTenant fires the tenant entity's postSave
    // hooks — tier-engine's auto-default-tier hook must run on self-signup
    // exactly like it does on the regular TenantHandlers.create HTTP path.
    const tierRows = await selectMany(stack.db, tierAssignmentTable, {
      tenantId: body.user?.tenantId ?? "",
    });
    expect(tierRows).toHaveLength(1);
    expect(tierRows[0]?.["tier"]).toBe("free");

    // Regression: seedUserWithPassword (called from
    // provisionSignupAccount) fires the `user` entity's postSave hooks too —
    // before this fix, only seedTenant's hooks param was wired through.
    expect(userPostSaveFired.count).toBe(1);

    // Regression: seedTenantMembership (called from
    // provisionSignupAccount) fires the `tenant-membership` entity's postSave
    // hooks too — before this fix, only seedTenant's hooks param was wired.
    expect(tenantMembershipPostSaveFired.count).toBe(1);
    // Rescope must put the new tenant on the hook context, not the
    // anonymous/system caller's tenantId.
    expect(tenantMembershipPostSaveFired.seenTenantIds).toEqual([body.user?.tenantId ?? ""]);

    // Proves that login with the password set during signup works.
    const loginRes = await postLogin(email, password);
    expect(loginRes.status).toBe(200);
  });

  test("a confirm request with X-Locale stores the locale and the first JWT carries it", async () => {
    const email = "locale-claim@example.com";
    const token = await requestSignup(email);

    const res = await stack.http.raw(
      "POST",
      "/api/auth/signup-confirm",
      { token, password: "fresh-secure-pw-1234" },
      { [LOCALE_HEADER_NAME]: "de-DE" },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { token: string };

    const payload = await stack.jwt.verify(body.token);
    expect(payload.locale).toBe("de-DE");
    const rows = await selectMany(stack.db, userTable, { email });
    expect(rows[0]?.["locale"]).toBe("de-DE");
  });

  test("a confirm request without a locale signal leaves the locale unset", async () => {
    const email = "no-locale-claim@example.com";
    const token = await requestSignup(email);

    const res = await postSignupConfirm(token, "fresh-secure-pw-1234");
    const body = (await res.json()) as { token: string };

    const payload = await stack.jwt.verify(body.token);
    expect(payload.locale).toBeUndefined();
  });

  test("Single-Use-Burn: zweiter confirm mit gleichem Token → 422 invalid_signup_token", async () => {
    const email = "burn@example.com";
    const password = "burn-test-pw-1234";
    const token = await requestSignup(email);

    const first = await postSignupConfirm(token, password);
    expect(first.status).toBe(200);

    const second = await postSignupConfirm(token, "another-pw-9876");
    expect(second.status).toBe(422);
    const body = (await second.json()) as {
      error?: { details?: { reason?: string } };
    };
    expect(body.error?.details?.reason).toBe(AuthErrors.invalidSignupToken);
  });

  test("unbekannter Token → 422 invalid_signup_token (Anti-Enumeration)", async () => {
    const res = await postSignupConfirm("nonexistent-token-xxxxxxxxxx", "any-pw-1234");
    expect(res.status).toBe(422);
    const body = (await res.json()) as {
      error?: { details?: { reason?: string } };
    };
    expect(body.error?.details?.reason).toBe(AuthErrors.invalidSignupToken);
  });

  test("zu kurzes Password → 400 invalid_body (Schema-Reject vor dispatcher)", async () => {
    const email = "short@example.com";
    const token = await requestSignup(email);
    const res = await postSignupConfirm(token, "tiny");
    expect(res.status).toBe(400);
  });

  test("mehrere sequentielle Signups → unterschiedliche tenant.key-Slugs", async () => {
    const keys: string[] = [];
    for (let i = 0; i < 3; i++) {
      const email = `multi-${i}@example.com`;
      const token = await requestSignup(email);
      const confirmRes = await postSignupConfirm(token, `multi-pw-${i}-1234`);
      expect(confirmRes.status).toBe(200);
      const body = (await confirmRes.json()) as { tenantKey: string };
      keys.push(body.tenantKey);
    }
    expect(new Set(keys).size).toBe(3);
  });

  test("bereits registrierte Email → 422 signup_email_already_registered, keine Session, kein neuer Tenant/Membership, kein Account-Takeover (#365)", async () => {
    const email = "victim@example.com";
    const victimPassword = "victim-original-pw-1234";

    // 1. Legitimer Erst-Signup: User + Tenant + Admin-Membership entstehen.
    const firstToken = await requestSignup(email);
    const firstRes = await postSignupConfirm(firstToken, victimPassword);
    expect(firstRes.status).toBe(200);
    const firstBody = (await firstRes.json()) as { user?: { id: string } };
    const victimUserId = firstBody.user?.id ?? "";
    expect(victimUserId).toBeTruthy();

    const userBefore = await selectMany(stack.db, userTable, { email });
    expect(userBefore).toHaveLength(1);
    const passwordHashBefore = userBefore[0]?.["passwordHash"];

    // 2. Attempt signup again for THE SAME email with an attacker-chosen
    //    password. The request remains 200 (anti-enumeration); after the
    //    first token is burned, it mints a fresh one.
    const attackerToken = await requestSignup(email);
    const attackerPassword = "attacker-chosen-pw-9999";
    const confirmRes = await postSignupConfirm(attackerToken, attackerPassword);

    // 3. Return a clean error and create NO session (no auth cookie).
    expect(confirmRes.status).toBe(422);
    const body = (await confirmRes.json()) as { error?: { details?: { reason?: string } } };
    expect(body.error?.details?.reason).toBe(AuthErrors.signupEmailAlreadyRegistered);
    expect(confirmRes.headers.get("set-cookie") ?? "").not.toContain("kumiko_auth=");

    // 4. Create no new tenant, including no orphaned tenant, or membership.
    const allTenants = await selectMany(stack.db, tenantTable);
    expect(allTenants).toHaveLength(1);
    const memberships = await selectMany(stack.db, tenantMembershipsTable, {
      userId: victimUserId,
    });
    expect(memberships).toHaveLength(1);

    // 5. The account is not taken over: there is one user, and the password
    //    hash remains unchanged (it is NOT overwritten with the attacker's
    //    password).
    const userAfter = await selectMany(stack.db, userTable, { email });
    expect(userAfter).toHaveLength(1);
    expect(userAfter[0]?.["passwordHash"]).toBe(passwordHashBefore);

    // 6. Authority proof: the existing account still uses the original
    //    password, while the attacker's password does not authenticate.
    const loginVictim = await postLogin(email, victimPassword);
    expect(loginVictim.status).toBe(200);
    const loginAttacker = await postLogin(email, attackerPassword);
    expect(loginAttacker.status).not.toBe(200);
  });

  test("common password → 400 (schema rejects breach-list password) (#1340)", async () => {
    const email = "common-signup@example.com";
    const token = await requestSignup(email);

    const confirmRes = await postSignupConfirm(token, "password1");
    expect(confirmRes.status).toBe(400);

    // No user created — the rejected confirm never landed.
    const userRows = await selectMany(stack.db, userTable, { email });
    expect(userRows).toHaveLength(0);
  });
});

describe("POST /api/auth/signup-request — mail locale follows the active browser language", () => {
  // The stack config sets no `signup.locale` (see beforeAll above) — this
  // isolates ctx.locale as the only possible source, so a German subject
  // here can only come from the X-Locale header, never from opts.locale.
  test("X-Locale: de → the activation mail is rendered in German", async () => {
    const res = await postSignupRequest("locale-de@example.com", { [LOCALE_HEADER_NAME]: "de" });
    expect(res.status).toBe(200);
    expect(emailTransport.sent).toHaveLength(1);
    const sent = emailTransport.sent[0];
    if (!sent) throw new Error("no mail sent");
    expect(sent.subject).toContain("Konto aktivieren");
  });

  test("no X-Locale header → the activation mail falls back to English", async () => {
    const res = await postSignupRequest("locale-default@example.com");
    expect(res.status).toBe(200);
    expect(emailTransport.sent).toHaveLength(1);
    const sent = emailTransport.sent[0];
    if (!sent) throw new Error("no mail sent");
    expect(sent.subject).toContain("Activate your account");
  });
});

describe("POST /api/auth/signup-request — opts.locale stays a real fallback", () => {
  // Regression guard: ctx.locale is always resolved (never undefined), so a
  // naive `ctx.locale ?? opts.locale` would make opts.locale unreachable and
  // silently drop every app's configured mail language the moment this PR
  // ships. This stack configures signup.locale statically (no defaultLocale
  // on the app context either) — a request with no X-Locale header must
  // still land in the handler's configured language, not "en".
  const optsLocaleTransport = createInMemoryTransport();
  let optsLocaleStack: TestStack;

  beforeAll(async () => {
    optsLocaleStack = await setupTestStack({
      features: [
        createConfigFeature(),
        createUserFeature(),
        createTenantFeature(),
        ...authMailRendererFeatures(),
        createDeliveryFeature(),
        createChannelEmailFeature({
          transport: optsLocaleTransport,
          resolveEmail: async () => "unused@test.local",
        }),
        createAuthEmailPasswordFeature({
          signup: { tokenTtlMinutes: 60, appUrl: APP_ACTIVATION_URL, locale: "de" },
        }),
      ],
      extraContext: (deps) => ({
        ...createDeliveryTestContext(deps),
        configResolver: createConfigResolver(),
      }),
      authConfig: {
        membershipQuery: "tenant:query:memberships",
        loginHandler: AuthHandlers.login,
        signup: {
          requestHandler: AuthHandlers.signupRequest,
          confirmHandler: AuthHandlers.signupConfirm,
        },
      },
    });
    await unsafeCreateEntityTable(optsLocaleStack.db, userEntity);
    await unsafeCreateEntityTable(optsLocaleStack.db, tenantEntity);
    await unsafePushTables(optsLocaleStack.db, {
      configValuesTable,
      tenantMembershipsTable,
      notificationPreferencesTable,
    });
    await seedAuthMailTemplates(optsLocaleStack);
  });

  afterAll(async () => {
    await optsLocaleStack.cleanup();
  });

  test("no X-Locale header → falls back to the handler's configured opts.locale, not English", async () => {
    const res = await optsLocaleStack.http.raw("POST", "/api/auth/signup-request", {
      email: "opts-locale@example.com",
    });
    expect(res.status).toBe(200);
    expect(optsLocaleTransport.sent).toHaveLength(1);
    const sent = optsLocaleTransport.sent[0];
    if (!sent) throw new Error("no mail sent");
    expect(sent.subject).toContain("Konto aktivieren");
  });
});

describe("POST /api/auth/signup-request — appUrl as a function picks the activation link's locale", () => {
  // This is the actual mechanism the whole PR exists for: an app with
  // language-in-path routing (/de/activate, /en/activate, ...) passes a
  // function instead of a plain string, and the resolved locale must land
  // in the link the user actually clicks — not just the mail's language.
  const appUrlTransport = createInMemoryTransport();
  let appUrlStack: TestStack;

  beforeAll(async () => {
    appUrlStack = await setupTestStack({
      features: [
        createConfigFeature(),
        createUserFeature(),
        createTenantFeature(),
        ...authMailRendererFeatures(),
        createDeliveryFeature(),
        createChannelEmailFeature({
          transport: appUrlTransport,
          resolveEmail: async () => "unused@test.local",
        }),
        createAuthEmailPasswordFeature({
          signup: {
            tokenTtlMinutes: 60,
            appUrl: (locale) => `https://app.example.com/${locale}/activate`,
          },
        }),
      ],
      extraContext: (deps) => ({
        ...createDeliveryTestContext(deps),
        configResolver: createConfigResolver(),
      }),
      authConfig: {
        membershipQuery: "tenant:query:memberships",
        loginHandler: AuthHandlers.login,
        signup: {
          requestHandler: AuthHandlers.signupRequest,
          confirmHandler: AuthHandlers.signupConfirm,
        },
      },
    });
    await unsafeCreateEntityTable(appUrlStack.db, userEntity);
    await unsafeCreateEntityTable(appUrlStack.db, tenantEntity);
    await unsafePushTables(appUrlStack.db, {
      configValuesTable,
      tenantMembershipsTable,
      notificationPreferencesTable,
    });
    await seedAuthMailTemplates(appUrlStack);
  });

  afterAll(async () => {
    await appUrlStack.cleanup();
  });

  test("X-Locale: de → the activation link in the sent mail points at /de/activate", async () => {
    const res = await appUrlStack.http.raw(
      "POST",
      "/api/auth/signup-request",
      { email: "appurl-de@example.com" },
      { [LOCALE_HEADER_NAME]: "de" },
    );
    expect(res.status).toBe(200);
    expect(appUrlTransport.sent).toHaveLength(1);
    const sent = appUrlTransport.sent[0];
    if (!sent) throw new Error("no mail sent");
    expect(sent.text).toContain("https://app.example.com/de/activate?token=");
    expect(sent.html).toContain("https://app.example.com/de/activate?token&#x3D;");
  });
});
