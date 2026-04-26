import { randomBytes } from "node:crypto";
import { createEncryptionProvider } from "@kumiko/framework/db";
import type { TenantId } from "@kumiko/framework/engine";
import {
  createEntityTable,
  pushTables,
  setupTestStack,
  type TestStack,
  TestUsers,
} from "@kumiko/framework/testing";
import { eq } from "drizzle-orm";
import { Temporal } from "temporal-polyfill";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { createConfigFeature } from "../../config";
import { createConfigResolver } from "../../config/resolver";
import { configValuesTable } from "../../config/table";
import { createTenantFeature } from "../../tenant";
import { tenantMembershipsTable } from "../../tenant/membership-table";
import { tenantEntity } from "../../tenant/schema/tenant";
import { seedTenantMembership } from "../../tenant/testing";
import { UserHandlers } from "../../user";
import { createUserFeature } from "../../user/feature";
import { userEntity, userTable } from "../../user/schema/user";
import { AuthErrors, AuthHandlers } from "../constants";
import { createAuthEmailPasswordFeature } from "../feature";
import { hashPassword } from "../password-hashing";
import { signResetToken } from "../reset-token";
import { signVerificationToken } from "../verification-token";

const capturedEmails: Array<{ email: string; verificationUrl: string; expiresAt: string }> = [];

let stack: TestStack;
const systemAdmin = TestUsers.systemAdmin;
const encryptionKey = randomBytes(32).toString("base64");
const verifySecret = randomBytes(32).toString("base64");
// Reset-flow co-configured so the cross-purpose-burn-isolation test can
// consume a reset token and then prove a verify token survives. Unused by
// the other tests in this file — no side effects on their setups.
const resetSecret = randomBytes(32).toString("base64");
const appVerifyUrl = "https://app.example.com/verify";
const appResetUrl = "https://app.example.com/reset";

beforeAll(async () => {
  const encryption = createEncryptionProvider(encryptionKey);
  const resolver = createConfigResolver({ encryption });

  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createUserFeature(),
      createTenantFeature(),
      createAuthEmailPasswordFeature({
        emailVerification: {
          hmacSecret: verifySecret,
          tokenTtlMinutes: 60,
          mode: "strict",
        },
        passwordReset: { hmacSecret: resetSecret, tokenTtlMinutes: 15 },
      }),
    ],
    extraContext: { configResolver: resolver, configEncryption: encryption },
    authConfig: {
      membershipQuery: "tenant:query:memberships",
      loginHandler: AuthHandlers.login,
      loginErrorStatusMap: {
        [AuthErrors.invalidCredentials]: 401,
        [AuthErrors.noMembership]: 403,
        [AuthErrors.emailNotVerified]: 403,
      },
      emailVerification: {
        requestHandler: AuthHandlers.requestEmailVerification,
        confirmHandler: AuthHandlers.verifyEmail,
        appVerifyUrl,
        sendVerificationEmail: async (args) => {
          capturedEmails.push(args);
        },
      },
      passwordReset: {
        requestHandler: AuthHandlers.requestPasswordReset,
        confirmHandler: AuthHandlers.resetPassword,
        appResetUrl,
        sendResetEmail: async () => {},
      },
    },
  });

  await createEntityTable(stack.db, userEntity);
  await createEntityTable(stack.db, tenantEntity);
  await pushTables(stack.db, { configValuesTable, tenantMembershipsTable });
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await stack.db.delete(userTable);
  await stack.db.delete(tenantMembershipsTable);
  capturedEmails.length = 0;
});

async function seedUser(opts: {
  email: string;
  password: string;
  emailVerified?: boolean;
  tenantId?: TenantId;
}): Promise<{ id: string; tenantId: TenantId }> {
  const hash = await hashPassword(opts.password);
  const created = await stack.http.writeOk<{ id: string }>(
    UserHandlers.create,
    {
      email: opts.email,
      passwordHash: hash,
      displayName: opts.email.split("@")[0] ?? "user",
    },
    systemAdmin,
  );
  // user:create schema doesn't expose emailVerified (by design — it's a
  // privileged field only the verify-email flow flips). Tests need a
  // pre-verified account for "login with verified user" cases, so we set
  // it directly via SQL after create. Row.version is left at 1; no
  // subsequent event-store writes happen on this row in these tests.
  if (opts.emailVerified === true) {
    await stack.db
      .update(userTable)
      .set({ emailVerified: true })
      .where(eq(userTable["id"], created.id));
  }
  const tenantId = opts.tenantId ?? "00000000-0000-4000-8000-000000000001";
  await seedTenantMembership(stack.db, {
    userId: created.id,
    tenantId,
    roles: ["User"],
  });
  return { id: created.id, tenantId };
}

async function post(path: string, body: unknown): Promise<Response> {
  return stack.http.raw("POST", path, body);
}

// --- request-email-verification -------------------------------------------

describe("POST /auth/request-email-verification", () => {
  test("unverified user → 200, email callback invoked with verification URL", async () => {
    await seedUser({ email: "fresh@example.com", password: "pw-initial-1234" });

    const res = await post("/api/auth/request-email-verification", {
      email: "fresh@example.com",
    });

    expect(res.status).toBe(200);
    expect(capturedEmails).toHaveLength(1);
    const [captured] = capturedEmails;
    if (!captured) throw new Error("no email captured");
    expect(captured.email).toBe("fresh@example.com");
    expect(captured.verificationUrl.startsWith(`${appVerifyUrl}?token=`)).toBe(true);
  });

  test("already-verified user → 200, NO callback (enumeration-safe)", async () => {
    await seedUser({
      email: "done@example.com",
      password: "pw-already-1234",
      emailVerified: true,
    });

    const res = await post("/api/auth/request-email-verification", {
      email: "done@example.com",
    });

    expect(res.status).toBe(200);
    expect(capturedEmails).toHaveLength(0);
  });

  test("unknown email → 200, NO callback (enumeration-safe)", async () => {
    const res = await post("/api/auth/request-email-verification", {
      email: "ghost@example.com",
    });
    expect(res.status).toBe(200);
    expect(capturedEmails).toHaveLength(0);
  });
});

// --- verify-email ----------------------------------------------------------

describe("POST /auth/verify-email", () => {
  test("valid token → emailVerified=true on the user row", async () => {
    const seed = await seedUser({ email: "ben@example.com", password: "pw-for-ben-1234" });
    const { token } = signVerificationToken(seed.id, 60, verifySecret);

    const res = await post("/api/auth/verify-email", { token });
    expect(res.status).toBe(200);

    const row = (await stack.db.select().from(userTable)).find((r) => r["id"] === seed.id);
    expect(row?.["emailVerified"]).toBe(true);
  });

  test("expired token via the route → 422 invalid_verification_token", async () => {
    const seed = await seedUser({ email: "time@example.com", password: "pw-time-1234" });
    const past = Temporal.Now.instant().subtract({ hours: 25 });
    const { token } = signVerificationToken(seed.id, 60, verifySecret, past);

    const res = await post("/api/auth/verify-email", { token });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error?.details?.reason).toBe(AuthErrors.invalidVerificationToken);
  });

  test("verify that fails before the write is retryable (burn released on failure)", async () => {
    // Symmetric to the reset-password retry test: if the confirm-flow
    // fails AFTER burning (here: no memberships → empty tenantOrder),
    // the finally-block in runConfirmTokenFlow releases the burn so
    // the user can click the same link again once ops restores state.
    const seed = await seedUser({ email: "retry@example.com", password: "pw-retry-1234" });
    const { token } = signVerificationToken(seed.id, 60, verifySecret);

    await stack.db.delete(tenantMembershipsTable);
    const firstAttempt = await post("/api/auth/verify-email", { token });
    expect(firstAttempt.status).toBe(422);

    await seedTenantMembership(stack.db, {
      userId: seed.id,
      tenantId: seed.tenantId,
      roles: ["User"],
    });

    const secondAttempt = await post("/api/auth/verify-email", { token });
    expect(secondAttempt.status).toBe(200);
  });

  test("cross-purpose burn isolation: consuming a reset-token doesn't block a verify-token for the same user+expiry", async () => {
    // The burn-store key includes purpose ("reset" vs "verify"). Tokens
    // signed with the SAME userId + expiresAtMs but different purpose
    // therefore occupy different burn slots. Without that separation,
    // a password-reset would incorrectly block a follow-up email
    // verification (or vice versa) during TTL overlap.
    const seed = await seedUser({ email: "iso@example.com", password: "initial-pw-1234" });
    const ts = Temporal.Now.instant();
    const { token: resetToken } = signResetToken(seed.id, 15, resetSecret, ts);
    const { token: verifyToken } = signVerificationToken(seed.id, 15, verifySecret, ts);

    const reset = await post("/api/auth/reset-password", {
      token: resetToken,
      newPassword: "after-reset-1234",
    });
    expect(reset.status).toBe(200);

    // Reset burned the "reset" slot. Verify uses the "verify" slot —
    // must be independent.
    const verify = await post("/api/auth/verify-email", { token: verifyToken });
    expect(verify.status).toBe(200);
  });

  test("replayed verify-token → 422 invalid_verification_token (single-use burn)", async () => {
    const seed = await seedUser({ email: "oneshot@example.com", password: "pw-oneshot-1234" });
    const { token } = signVerificationToken(seed.id, 60, verifySecret);

    const first = await post("/api/auth/verify-email", { token });
    expect(first.status).toBe(200);

    const second = await post("/api/auth/verify-email", { token });
    expect(second.status).toBe(422);
    const body = await second.json();
    expect(body.error?.details?.reason).toBe(AuthErrors.invalidVerificationToken);
  });

  test("reset-token replayed as verify-token → 422 (cross-purpose blocked)", async () => {
    const seed = await seedUser({ email: "cross@example.com", password: "pw-cross-1234" });
    // Sign a token with a different purpose but the SAME secret+userId —
    // the verify-token verify() must reject it.
    const { signResetToken } = await import("../reset-token");
    const { token } = signResetToken(seed.id, 60, verifySecret);

    const res = await post("/api/auth/verify-email", { token });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error?.details?.reason).toBe(AuthErrors.invalidVerificationToken);
  });
});

// --- login gate (strict mode) ---------------------------------------------

describe("login with strict email-verification", () => {
  test("unverified user → 403 email_not_verified (post-password check)", async () => {
    await seedUser({ email: "locked@example.com", password: "pw-locked-1234" });

    const res = await post("/api/auth/login", {
      email: "locked@example.com",
      password: "pw-locked-1234",
    });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error?.details?.reason).toBe(AuthErrors.emailNotVerified);
  });

  test("verified user → 200, token returned", async () => {
    await seedUser({
      email: "verified@example.com",
      password: "pw-verif-1234",
      emailVerified: true,
    });

    const res = await post("/api/auth/login", {
      email: "verified@example.com",
      password: "pw-verif-1234",
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.isSuccess).toBe(true);
    expect(typeof body.token).toBe("string");
  });

  test("wrong password → still invalid_credentials (verification-check runs AFTER)", async () => {
    await seedUser({ email: "pwprobe@example.com", password: "pw-probe-1234" });

    const res = await post("/api/auth/login", {
      email: "pwprobe@example.com",
      password: "nope",
    });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error?.details?.reason).toBe(AuthErrors.invalidCredentials);
  });
});
