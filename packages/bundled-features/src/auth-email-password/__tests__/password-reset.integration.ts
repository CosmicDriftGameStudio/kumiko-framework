import { randomBytes } from "node:crypto";
import { createEncryptionProvider } from "@cosmicdrift/kumiko-framework/db";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import {
  setupTestStack,
  type TestStack,
  TestUsers,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import { Temporal } from "temporal-polyfill";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { createConfigFeature } from "../../config";
import { createConfigResolver } from "../../config/resolver";
import { configValuesTable } from "../../config/table";
import { createSessionsFeature, userSessionTable } from "../../sessions";
import { createTenantFeature } from "../../tenant";
import { tenantMembershipsTable } from "../../tenant/membership-table";
import { tenantEntity } from "../../tenant/schema/tenant";
import { seedTenantMembership } from "../../tenant/testing";
import { UserHandlers } from "../../user";
import { createUserFeature } from "../../user/feature";
import { userEntity, userTable } from "../../user/schema/user";
import { AuthErrors, AuthHandlers } from "../constants";
import { createAuthEmailPasswordFeature } from "../feature";
import { hashPassword, verifyPassword } from "../password-hashing";
import { signResetToken } from "../reset-token";

// Signed tokens are forwarded out-of-band (email). In the test we grab them
// from the sendResetEmail callback instead.
const capturedEmails: Array<{ email: string; resetUrl: string; expiresAt: string }> = [];

// Records the userId every time the sessions feature's auto-revoke hook
// fires after a password change. The session-revoke tests assert on this
// list — we don't need a full session store, just proof the hook fired.
const autoRevokeCalls: string[] = [];

let stack: TestStack;
const systemAdmin = TestUsers.systemAdmin;
const encryptionKey = randomBytes(32).toString("base64");
const resetSecret = randomBytes(32).toString("base64");
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
        passwordReset: { hmacSecret: resetSecret, tokenTtlMinutes: 15 },
      }),
      // Sessions feature wires the cross-feature entityHook on
      // "user.postSave" that triggers autoRevokeOnPasswordChange whenever
      // the passwordHash delta is present. Integration-test proves the
      // reset-flow's changes.passwordHash triggers the same hook.
      createSessionsFeature({
        autoRevokeOnPasswordChange: async (userId) => {
          autoRevokeCalls.push(userId);
          return 0; // no real session store behind this spy
        },
      }),
    ],
    extraContext: { configResolver: resolver, configEncryption: encryption },
    authConfig: {
      membershipQuery: "tenant:query:memberships",
      loginHandler: AuthHandlers.login,
      passwordReset: {
        requestHandler: AuthHandlers.requestPasswordReset,
        confirmHandler: AuthHandlers.resetPassword,
        appResetUrl,
        sendResetEmail: async (args) => {
          capturedEmails.push(args);
        },
      },
    },
  });

  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafeCreateEntityTable(stack.db, tenantEntity);
  await unsafePushTables(stack.db, {
    configValuesTable,
    tenantMembershipsTable,
    userSessionTable,
  });
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await stack.db.delete(userTable);
  await stack.db.delete(tenantMembershipsTable);
  await stack.db.delete(userSessionTable);
  capturedEmails.length = 0;
  autoRevokeCalls.length = 0;
});

async function seedUser(opts: {
  email: string;
  password: string;
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

// --- request-password-reset -----------------------------------------------

describe("POST /auth/request-password-reset", () => {
  test("known email → 200, email callback invoked with reset URL", async () => {
    await seedUser({ email: "alice@example.com", password: "initial-pw!" });

    const res = await post("/api/auth/request-password-reset", { email: "alice@example.com" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ isSuccess: true });
    expect(capturedEmails).toHaveLength(1);
    const [captured] = capturedEmails;
    if (!captured) throw new Error("no email captured");
    expect(captured.email).toBe("alice@example.com");
    expect(captured.resetUrl.startsWith(`${appResetUrl}?token=`)).toBe(true);
    expect(typeof captured.expiresAt).toBe("string");
  });

  test("unknown email → 200 with NO sendResetEmail side-effect (enumeration-safe)", async () => {
    const res = await post("/api/auth/request-password-reset", { email: "ghost@example.com" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ isSuccess: true });
    expect(capturedEmails).toHaveLength(0);
  });

  test("malformed body → 200 (silent success, no enumeration via error shape)", async () => {
    const res = await post("/api/auth/request-password-reset", { wrong: "shape" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ isSuccess: true });
    expect(capturedEmails).toHaveLength(0);
  });
});

// --- reset-password --------------------------------------------------------

describe("POST /auth/reset-password", () => {
  test("valid token → password set; login works with new password", async () => {
    const seed = await seedUser({ email: "bob@example.com", password: "old-pw-1234" });

    // Generate the token the same way the handler does — bypassing the email
    // hop keeps the test deterministic.
    const { token } = signResetToken(seed.id, 15, resetSecret);

    const res = await post("/api/auth/reset-password", {
      token,
      newPassword: "brand-new-pw-9876",
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ isSuccess: true });

    // Proof: the new password actually hashes in. Read the row, verify the
    // hash matches the new plaintext.
    const row = (await stack.db.select().from(userTable)).find((r) => r["id"] === seed.id);
    if (!row?.["passwordHash"]) throw new Error("user row / hash missing");
    expect(await verifyPassword(row["passwordHash"] as string, "brand-new-pw-9876")).toBe(true);
    expect(await verifyPassword(row["passwordHash"] as string, "old-pw-1234")).toBe(false);
  });

  test("tampered token → 422 invalid_reset_token", async () => {
    const seed = await seedUser({ email: "carol@example.com", password: "keep-me!" });
    const { token } = signResetToken(seed.id, 15, resetSecret);
    const tampered = `${token.slice(0, -3)}XXX`;

    const res = await post("/api/auth/reset-password", {
      token: tampered,
      newPassword: "new-password-1234",
    });

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error?.details?.reason).toBe(AuthErrors.invalidResetToken);

    // Old password still wins.
    const row = (await stack.db.select().from(userTable)).find((r) => r["id"] === seed.id);
    if (!row?.["passwordHash"]) throw new Error("user row / hash missing");
    expect(await verifyPassword(row["passwordHash"] as string, "keep-me!")).toBe(true);
  });

  test("token signed with different secret → 422 (not auth via other deployments' tokens)", async () => {
    const seed = await seedUser({ email: "dave@example.com", password: "original" });
    const { token } = signResetToken(seed.id, 15, "wrong-secret-wrong-secret-wrong!!");

    const res = await post("/api/auth/reset-password", {
      token,
      newPassword: "should-not-stick-1234",
    });

    expect(res.status).toBe(422);
  });

  test("too-short newPassword → 400 (schema rejects <8 chars)", async () => {
    const seed = await seedUser({ email: "eve@example.com", password: "original" });
    const { token } = signResetToken(seed.id, 15, resetSecret);

    const res = await post("/api/auth/reset-password", {
      token,
      newPassword: "tiny",
    });

    expect(res.status).toBe(400);
  });

  test("expired token via the route → 422 invalid_reset_token", async () => {
    const seed = await seedUser({ email: "time@example.com", password: "once-valid-1234" });
    // Sign with now set far in the past so expiry already fired.
    const past = Temporal.Now.instant().subtract({ minutes: 30 });
    const { token } = signResetToken(seed.id, 15, resetSecret, past);

    const res = await post("/api/auth/reset-password", {
      token,
      newPassword: "brand-new-pw-time",
    });

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error?.details?.reason).toBe(AuthErrors.invalidResetToken);
  });

  test("reset that fails before the write is retryable (burn is released on failure)", async () => {
    // The burn marker goes down BEFORE the state change so a racing replay
    // can't slip through. But if the state change itself fails — e.g. no
    // memberships in the row, every tenant stream rejected, DB error —
    // the token was never actually consumed. The handler releases the
    // burn in those branches so the user can click the link again
    // without hitting a stuck "already-used".
    //
    // Repro: drop the user's membership → tenantOrder is empty →
    // invalidToken + unburn. Re-insert membership → second attempt
    // with the same token succeeds (proves the burn was released).
    const seed = await seedUser({ email: "retry@example.com", password: "pw-retry-1234" });
    const { token } = signResetToken(seed.id, 15, resetSecret);

    await stack.db.delete(tenantMembershipsTable);
    const firstAttempt = await post("/api/auth/reset-password", {
      token,
      newPassword: "never-lands-1234",
    });
    expect(firstAttempt.status).toBe(422);

    // Re-insert the membership. Same userId, same token still valid.
    await seedTenantMembership(stack.db, {
      userId: seed.id,
      tenantId: seed.tenantId,
      roles: ["User"],
    });

    const secondAttempt = await post("/api/auth/reset-password", {
      token,
      newPassword: "finally-lands-1234",
    });
    expect(secondAttempt.status).toBe(200);
  });

  test("replayed reset-token → 422 invalid_reset_token (single-use burn)", async () => {
    // Reset tokens are single-use: the handler burns them in Redis via
    // SETNX before the state change. First click wins; replay within TTL
    // collapses to the same invalid_reset_token code as a tampered or
    // expired token — no leak that "this token was legitimately used".
    const seed = await seedUser({ email: "twice@example.com", password: "first-pw-1234" });
    const { token } = signResetToken(seed.id, 15, resetSecret);

    const first = await post("/api/auth/reset-password", { token, newPassword: "next-pw-1234" });
    expect(first.status).toBe(200);

    const second = await post("/api/auth/reset-password", {
      token,
      newPassword: "yet-another-pw-1234",
    });
    expect(second.status).toBe(422);
    const body = await second.json();
    expect(body.error?.details?.reason).toBe(AuthErrors.invalidResetToken);
  });
});

// --- session auto-revoke (H.3 cross-feature hook) -------------------------

describe("reset-password triggers session auto-revoke", () => {
  test("successful reset fires the sessions-feature entityHook on user", async () => {
    const seed = await seedUser({
      email: "revokeme@example.com",
      password: "hack-exposed-1234",
    });
    const { token } = signResetToken(seed.id, 15, resetSecret);

    const res = await post("/api/auth/reset-password", {
      token,
      newPassword: "fresh-secure-1234",
    });
    expect(res.status).toBe(200);

    // The sessions feature registered r.entityHook("postSave", "user", ...)
    // with autoRevokeOnPasswordChange. Reset writes changes.passwordHash
    // through user:update → hook fires → spy records the userId. Without
    // this assertion the commit's "session revocation" claim is unverified.
    expect(autoRevokeCalls).toEqual([seed.id]);
  });

  test("failed reset (invalid token) does NOT trigger auto-revoke", async () => {
    const seed = await seedUser({
      email: "keepme@example.com",
      password: "still-mine-1234",
    });

    const res = await post("/api/auth/reset-password", {
      token: "fake.1234567890.whatever",
      newPassword: "does-not-matter-1234",
    });
    expect(res.status).toBe(422);
    // No passwordHash write → no hook → no revoke. Otherwise a garbage-
    // token spammer could log everyone out.
    expect(autoRevokeCalls).toEqual([]);
    expect(seed.id).toBeTruthy(); // silence lint on unused var
  });
});
