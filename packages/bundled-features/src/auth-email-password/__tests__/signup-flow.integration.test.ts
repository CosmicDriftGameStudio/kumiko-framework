// Magic-Link-Self-Signup Full-Stack Integration-Test. Spec ist der
// Test selbst (advisor-Empfehlung). Geht durch HTTP, weil
// stack.dispatcher nicht exposed ist und die Routes ohnehin der
// reale User-Pfad sind.
//
// Pinst:
//   1. POST signup-request mit valid email → 200, Activation-Mail via
//      delivery (channel-email in-memory transport) mit Token-URL.
//   2. Resend-Idempotenz: zweiter Request für selbe email → gleicher
//      Token in Mail (existing token in Redis wird re-genutzt).
//   3. POST signup-confirm mit captured Token + Password → 200, Cookies
//      gesetzt (kumiko_auth + kumiko_csrf), Body mit user + tenantKey,
//      DB hat user (emailVerified=true) + tenant + Admin-membership.
//   4. POST /api/auth/login mit demselben Password → 200 (Authority-
//      Beweis: tenant + user + membership wirklich da, Auto-Login
//      könnte stattdessen den JWT aus signup-confirm verwenden, aber
//      dieser zweite Login schließt aus dass die signup-confirm-
//      pipeline irgendetwas verschluckt hat).
//   5. Replay: zweiter signup-confirm mit gleichem Token → 422
//      invalid_signup_token (single-use burn).
//   6. Token-not-found / abgelaufen → 422 invalid_signup_token
//      (uniformer Code, kein Enumeration-leak).
//   7. Sequential Signups → unique tenantKey-Slugs (TOCTOU-Schutz
//      via DB-unique-index + generateUniqueName-isAvailable-check
//      zusammen).

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { asRawClient, selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { buildEntityTable } from "@cosmicdrift/kumiko-framework/db";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import { createChannelEmailFeature, createInMemoryTransport } from "../../channel-email";
import { createConfigFeature } from "../../config";
import { createConfigResolver } from "../../config/resolver";
import { configValuesTable } from "../../config/table";
import { createDeliveryFeature, createDeliveryTestContext } from "../../delivery";
import { notificationPreferencesTable } from "../../delivery/tables";
import { createRendererFoundationFeature } from "../../renderer-foundation/feature";
import { createRendererSimpleFeature, simpleRenderer } from "../../renderer-simple";
import { createTemplateResolverFeature } from "../../template-resolver/feature";
import { createTenantFeature } from "../../tenant";
import { tenantMembershipsTable } from "../../tenant/membership-table";
import { tenantEntity, tenantTable } from "../../tenant/schema/tenant";
// kumiko-lint-ignore cross-feature-import regression-proof for #1463: seedTenant
// must fire tier-engine's entity postSave hook on self-signup, not just on the
// TenantHandlers.create HTTP path.
import { tierAssignmentEntity } from "../../tier-engine/entity";
import { createTierEngineFeature } from "../../tier-engine/feature";
import { createUserFeature } from "../../user/feature";
import { userEntity, userTable } from "../../user/schema/user";
import { AuthErrors, AuthHandlers } from "../constants";
import { createAuthEmailPasswordFeature } from "../feature";

const tierAssignmentTable = buildEntityTable("tier-assignment", tierAssignmentEntity);

const APP_ACTIVATION_URL = "https://app.example.com/signup/complete";

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
      createTemplateResolverFeature(),
      createRendererFoundationFeature(),
      createDeliveryFeature(),
      createRendererSimpleFeature(),
      createChannelEmailFeature({
        transport: emailTransport,
        renderer: simpleRenderer,
        // route:{email} delivers directly — resolveEmail (userId→address) is
        // never hit by the signup flow, but the channel requires it.
        resolveEmail: async () => "unused@test.local",
      }),
      createAuthEmailPasswordFeature({
        signup: { tokenTtlMinutes: 60, appUrl: APP_ACTIVATION_URL },
      }),
      // Regression-proof for #1463: seedTenant must fire the entity postSave
      // hook on self-signup too, not just on the TenantHandlers.create path.
      createTierEngineFeature({
        defaultTier: "free",
        tierMap: { free: { features: [], caps: {} } },
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

  await unsafeCreateEntityTable(stack.db, userEntity);
  // tenant-entity hat den unique-constraint auf .key (siehe
  // tenant.schema.indexes). unsafeCreateEntityTable baut das via
  // buildEntityTable nach — pinst den TOCTOU-Schutz für signup-confirm.
  await unsafeCreateEntityTable(stack.db, tenantEntity);
  await unsafePushTables(stack.db, {
    configValuesTable,
    tenantMembershipsTable,
    notificationPreferencesTable,
    tierAssignmentTable,
  });
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
  // Redis-cleanup damit Resend-Tests keine state-leaks haben.
  const allKeys = await stack.redis.redis.keys("signup:*");
  if (allKeys.length > 0) await stack.redis.redis.del(...allKeys);
});

async function postSignupRequest(email: string): Promise<Response> {
  return stack.http.raw("POST", "/api/auth/signup-request", { email });
}

async function postSignupConfirm(token: string, password: string): Promise<Response> {
  return stack.http.raw("POST", "/api/auth/signup-confirm", { token, password });
}

async function postLogin(email: string, password: string): Promise<Response> {
  return stack.http.raw("POST", "/api/auth/login", { email, password });
}

function extractTokenFromMail(html: string): string {
  const match = html.match(/[?&]token=([^&"'<\s]+)/);
  if (!match?.[1]) throw new Error(`No token in mail html: ${html.slice(0, 200)}`);
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
    expect(sent.html).toContain(`${APP_ACTIVATION_URL}?token=`);
  });

  test("Resend: zweiter Request für selbe email → gleicher token in Mail", async () => {
    await postSignupRequest("resend@example.com");
    await postSignupRequest("resend@example.com");

    expect(emailTransport.sent).toHaveLength(2);
    const [first, second] = emailTransport.sent;
    if (!first || !second) throw new Error("missing mails");
    expect(extractTokenFromMail(second.html)).toBe(extractTokenFromMail(first.html));
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
    return extractTokenFromMail(sent.html);
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
    expect(body.user?.roles).toContain("Admin");
    expect(body.tenantKey).toBeTruthy();

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

    const memberships = await selectMany(stack.db, tenantMembershipsTable, {
      userId: body.user?.id ?? "",
    });
    expect(memberships).toHaveLength(1);
    const rolesRaw = memberships[0]?.["roles"];
    if (typeof rolesRaw === "string") {
      expect(JSON.parse(rolesRaw) as string[]).toContain("Admin");
    }

    // #1463 regression: seedTenant fires the tenant entity's postSave
    // hooks — tier-engine's auto-default-tier hook must run on self-signup
    // exactly like it does on the regular TenantHandlers.create HTTP path.
    const tierRows = await selectMany(stack.db, tierAssignmentTable, {
      tenantId: body.user?.tenantId ?? "",
    });
    expect(tierRows).toHaveLength(1);
    expect(tierRows[0]?.["tier"]).toBe("free");

    // Authority-Beweis: Login mit dem gesetzten Password funktioniert.
    const loginRes = await postLogin(email, password);
    expect(loginRes.status).toBe(200);
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

    // 2. Zweiter Signup-Versuch für DIESELBE Email mit Angreifer-Passwort.
    //    Request bleibt always-200 (Anti-Enumeration); nach dem Burn des
    //    ersten Tokens mintet er einen frischen.
    const attackerToken = await requestSignup(email);
    const attackerPassword = "attacker-chosen-pw-9999";
    const confirmRes = await postSignupConfirm(attackerToken, attackerPassword);

    // 3. Sauberer Fehler, KEINE Session (kein auth-Cookie).
    expect(confirmRes.status).toBe(422);
    const body = (await confirmRes.json()) as { error?: { details?: { reason?: string } } };
    expect(body.error?.details?.reason).toBe(AuthErrors.signupEmailAlreadyRegistered);
    expect(confirmRes.headers.get("set-cookie") ?? "").not.toContain("kumiko_auth=");

    // 4. Kein neuer Tenant (auch kein verwaister), keine neue Membership.
    const allTenants = await selectMany(stack.db, tenantTable);
    expect(allTenants).toHaveLength(1);
    const memberships = await selectMany(stack.db, tenantMembershipsTable, {
      userId: victimUserId,
    });
    expect(memberships).toHaveLength(1);

    // 5. Account nicht übernommen: ein User, Passwort-Hash unverändert (NICHT
    //    auf das Angreifer-Passwort überschrieben).
    const userAfter = await selectMany(stack.db, userTable, { email });
    expect(userAfter).toHaveLength(1);
    expect(userAfter[0]?.["passwordHash"]).toBe(passwordHashBefore);

    // 6. Authority-Beweis: der bestehende Account hängt weiter am Original-
    //    Passwort, das Angreifer-Passwort loggt nicht ein.
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
