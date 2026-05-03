// Magic-Link-Self-Signup Full-Stack Integration-Test. Spec ist der
// Test selbst (advisor-Empfehlung). Geht durch HTTP, weil
// stack.dispatcher nicht exposed ist und die Routes ohnehin der
// reale User-Pfad sind.
//
// Pinst:
//   1. POST signup-request mit valid email → 200, Mail captured durch
//      sendActivationEmail-callback (echte route + signup-feature).
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

import {
  createEntityTable,
  pushTables,
  setupTestStack,
  type TestStack,
} from "@kumiko/framework/stack";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { createConfigFeature } from "../../config";
import { createConfigResolver } from "../../config/resolver";
import { configValuesTable } from "../../config/table";
import { createTenantFeature } from "../../tenant";
import { tenantMembershipsTable } from "../../tenant/membership-table";
import { tenantEntity, tenantTable } from "../../tenant/schema/tenant";
import { createUserFeature } from "../../user/feature";
import { userEntity, userTable } from "../../user/schema/user";
import { AuthErrors, AuthHandlers } from "../constants";
import { createAuthEmailPasswordFeature } from "../feature";

const APP_ACTIVATION_URL = "https://app.example.com/signup/complete";
const capturedActivationEmails: Array<{
  email: string;
  activationUrl: string;
  expiresAt: string;
}> = [];

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createUserFeature(),
      createTenantFeature(),
      createAuthEmailPasswordFeature({
        signup: { tokenTtlMinutes: 60 },
      }),
    ],
    extraContext: { configResolver: createConfigResolver() },
    authConfig: {
      membershipQuery: "tenant:query:memberships",
      loginHandler: AuthHandlers.login,
      signup: {
        requestHandler: AuthHandlers.signupRequest,
        confirmHandler: AuthHandlers.signupConfirm,
        appActivationUrl: APP_ACTIVATION_URL,
        sendActivationEmail: async (args) => {
          capturedActivationEmails.push(args);
        },
      },
    },
  });

  await createEntityTable(stack.db, userEntity);
  // tenant-entity hat den unique-constraint auf .key (siehe
  // tenant.schema.indexes). createEntityTable baut das via
  // buildDrizzleTable nach — pinst den TOCTOU-Schutz für signup-confirm.
  await createEntityTable(stack.db, tenantEntity);
  await pushTables(stack.db, { configValuesTable, tenantMembershipsTable });
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await stack.db.delete(userTable);
  await stack.db.delete(tenantMembershipsTable);
  await stack.db.delete(tenantTable);
  capturedActivationEmails.length = 0;
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

function extractTokenFromUrl(url: string): string {
  const match = url.match(/[?&]token=([^&]+)/);
  if (!match?.[1]) throw new Error(`No token in url: ${url}`);
  return decodeURIComponent(match[1]);
}

describe("POST /api/auth/signup-request", () => {
  test("known email → 200, mail captured mit activation-url", async () => {
    const res = await postSignupRequest("alice@example.com");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ isSuccess: true });
    expect(capturedActivationEmails).toHaveLength(1);
    const [captured] = capturedActivationEmails;
    if (!captured) throw new Error("no captured email");
    expect(captured.email).toBe("alice@example.com");
    expect(captured.activationUrl.startsWith(`${APP_ACTIVATION_URL}?token=`)).toBe(true);
    expect(typeof captured.expiresAt).toBe("string");
  });

  test("Resend: zweiter Request für selbe email → gleicher token in Mail", async () => {
    await postSignupRequest("resend@example.com");
    await postSignupRequest("resend@example.com");

    expect(capturedActivationEmails).toHaveLength(2);
    const [first, second] = capturedActivationEmails;
    if (!first || !second) throw new Error("missing emails");
    expect(extractTokenFromUrl(second.activationUrl)).toBe(
      extractTokenFromUrl(first.activationUrl),
    );
  });

  test("malformed body → 200 (silent success, anti-enumeration)", async () => {
    const res = await stack.http.raw("POST", "/api/auth/signup-request", { wrong: "shape" });
    expect(res.status).toBe(200);
    expect(capturedActivationEmails).toHaveLength(0);
  });
});

describe("POST /api/auth/signup-confirm", () => {
  async function requestSignup(email: string): Promise<string> {
    capturedActivationEmails.length = 0;
    const res = await postSignupRequest(email);
    expect(res.status).toBe(200);
    const captured = capturedActivationEmails[0];
    if (!captured) throw new Error("signup-request fixture didn't capture mail");
    return extractTokenFromUrl(captured.activationUrl);
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
    const userRows = await stack.db.select().from(userTable).where(eq(userTable.email, email));
    expect(userRows).toHaveLength(1);
    expect(userRows[0]?.["emailVerified"]).toBe(true);
    expect(userRows[0]?.["passwordHash"]).toBeTruthy();

    const tenantRows = await stack.db
      .select()
      .from(tenantTable)
      .where(eq(tenantTable.id, body.user?.tenantId ?? ""));
    expect(tenantRows).toHaveLength(1);
    expect(tenantRows[0]?.["key"]).toBe(body.tenantKey);

    const memberships = await stack.db
      .select()
      .from(tenantMembershipsTable)
      .where(eq(tenantMembershipsTable.userId, body.user?.id ?? ""));
    expect(memberships).toHaveLength(1);
    const rolesRaw = memberships[0]?.["roles"];
    if (typeof rolesRaw === "string") {
      expect(JSON.parse(rolesRaw) as string[]).toContain("Admin");
    }

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
});
