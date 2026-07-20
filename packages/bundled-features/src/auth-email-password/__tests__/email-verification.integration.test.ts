import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { asRawClient, selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { SYSTEM_TENANT_ID, type TenantId } from "@cosmicdrift/kumiko-framework/engine";
import {
  setupTestStack,
  type TestStack,
  TestUsers,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import {
  createTestEnvelopeCipher,
  seedRow,
  updateRows,
} from "@cosmicdrift/kumiko-framework/testing";
import { Temporal } from "temporal-polyfill";
import { createChannelEmailFeature, createInMemoryTransport } from "../../channel-email";
import { createConfigFeature } from "../../config";
import { createConfigResolver } from "../../config/resolver";
import { configValuesTable } from "../../config/table";
import { createDeliveryFeature, createDeliveryTestContext } from "../../delivery";
import { notificationPreferencesTable } from "../../delivery/tables";
import { createRendererFoundationFeature } from "../../renderer-foundation/feature";
import { createRendererSimpleFeature, simpleRenderer } from "../../renderer-simple";
import { hashPassword } from "../../shared";
import { createTemplateResolverFeature } from "../../template-resolver/feature";
import { createTenantFeature } from "../../tenant";
import { tenantMembershipsTable } from "../../tenant/membership-table";
import { tenantEntity } from "../../tenant/schema/tenant";
import { seedTenantMembership } from "../../tenant/testing";
import { UserHandlers } from "../../user";
import { createUserFeature } from "../../user/feature";
import { userEntity, userTable } from "../../user/schema/user";
import { AuthErrors, AuthHandlers } from "../constants";
import { createAuthEmailPasswordFeature } from "../feature";
import { signResetToken } from "../reset-token";
import { signVerificationToken } from "../verification-token";

// Verify mails now go through delivery (ctx.notify → channel-email); the
// in-memory transport captures what would be sent.
const emailTransport = createInMemoryTransport();

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
  const encryption = createTestEnvelopeCipher(encryptionKey);
  const resolver = createConfigResolver({ cipher: encryption });

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
        resolveEmail: async () => "unused@test.local",
      }),
      createAuthEmailPasswordFeature({
        emailVerification: {
          hmacSecret: verifySecret,
          tokenTtlMinutes: 60,
          mode: "strict",
          appUrl: appVerifyUrl,
        },
        passwordReset: { hmacSecret: resetSecret, tokenTtlMinutes: 15, appUrl: appResetUrl },
      }),
    ],
    extraContext: (deps) => ({
      ...createDeliveryTestContext(deps),
      configResolver: resolver,
      configEncryption: encryption,
    }),
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
      },
      passwordReset: {
        requestHandler: AuthHandlers.requestPasswordReset,
        confirmHandler: AuthHandlers.resetPassword,
      },
    },
  });

  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafeCreateEntityTable(stack.db, tenantEntity);
  await unsafePushTables(stack.db, {
    configValuesTable,
    tenantMembershipsTable,
    notificationPreferencesTable,
  });
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await asRawClient(stack.db).unsafe(`DELETE FROM "${userTable.tableName}"`);
  await asRawClient(stack.db).unsafe(`DELETE FROM "${tenantMembershipsTable.tableName}"`);
  emailTransport.sent.length = 0;
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
    await updateRows(stack.db, userTable, { emailVerified: true }, { id: created.id });
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
  test("unverified user → 200, delivery sends mail with verification URL", async () => {
    await seedUser({ email: "fresh@example.com", password: "pw-initial-1234" });

    const res = await post("/api/auth/request-email-verification", {
      email: "fresh@example.com",
    });

    expect(res.status).toBe(200);
    expect(emailTransport.sent).toHaveLength(1);
    const sent = emailTransport.sent[0];
    if (!sent) throw new Error("no email sent");
    expect(sent.to).toBe("fresh@example.com");
    expect(sent.html).toContain(`${appVerifyUrl}?token=`);
  });

  test("already-verified user → 200, NO mail (enumeration-safe)", async () => {
    await seedUser({
      email: "done@example.com",
      password: "pw-already-1234",
      emailVerified: true,
    });

    const res = await post("/api/auth/request-email-verification", {
      email: "done@example.com",
    });

    expect(res.status).toBe(200);
    expect(emailTransport.sent).toHaveLength(0);
  });

  test("unknown email → 200, NO mail (enumeration-safe)", async () => {
    const res = await post("/api/auth/request-email-verification", {
      email: "ghost@example.com",
    });
    expect(res.status).toBe(200);
    expect(emailTransport.sent).toHaveLength(0);
  });
});

// --- verify-email ----------------------------------------------------------

describe("POST /auth/verify-email", () => {
  test("valid token → emailVerified=true on the user row", async () => {
    const seed = await seedUser({ email: "ben@example.com", password: "pw-for-ben-1234" });
    const { token } = signVerificationToken(seed.id, 60, verifySecret);

    const res = await post("/api/auth/verify-email", { token });
    expect(res.status).toBe(200);

    const row = (await selectMany(stack.db, userTable)).find((r) => r["id"] === seed.id);
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
    // Symmetric to the reset-password retry test: if the confirm-flow fails
    // AFTER burning, the finally-block in runConfirmTokenFlow releases the
    // burn so the user can click the same link again once ops restores state.
    //
    // Trigger: delete the user READ-MODEL row (kumiko_events untouched) →
    // loadValidatedUser returns null after the burn → invalidToken + unburn.
    // Re-insert the same row verbatim → retry with the SAME token succeeds.
    //
    // (Membership-deletion no longer fails: the stream lives in
    // systemAdmin.tenantId and is recovered with zero memberships — see the
    // zero-membership-sysadmin test below.)
    const seed = await seedUser({ email: "retry@example.com", password: "pw-retry-1234" });
    const { token } = signVerificationToken(seed.id, 60, verifySecret);

    const userRow = (await selectMany(stack.db, userTable)).find((r) => r["id"] === seed.id);
    if (!userRow) throw new Error("seeded user row missing");
    await asRawClient(stack.db).unsafe(`DELETE FROM "${userTable.tableName}" WHERE id = $1`, [
      seed.id,
    ]);

    const firstAttempt = await post("/api/auth/verify-email", { token });
    expect(firstAttempt.status).toBe(422);

    await seedRow(stack.db, userTable, userRow);

    const secondAttempt = await post("/api/auth/verify-email", { token });
    expect(secondAttempt.status).toBe(200);
  });

  test("zero-membership sysadmin can still verify (stream recovered without any membership)", async () => {
    // 205#1: a systemScope user whose stream lives in systemAdmin.tenantId
    // (…0001) but who holds NO membership must still resolve. The stream-
    // tenant recovery runs BEFORE the empty-membership check, so verify
    // targets …0001 and lands instead of collapsing to invalid_token.
    const seed = await seedUser({ email: "lonely-admin@example.com", password: "pw-lonely-1234" });
    await asRawClient(stack.db).unsafe(`DELETE FROM "${tenantMembershipsTable.tableName}"`);

    const streamRows = (await asRawClient(stack.db).unsafe(
      `SELECT "tenant_id" FROM "kumiko_events" WHERE "aggregate_id" = $1 AND "aggregate_type" = 'user' ORDER BY "version" LIMIT 1`,
      [seed.id],
    )) as ReadonlyArray<{ tenant_id: string }>;
    expect(streamRows[0]?.tenant_id).toBe(SYSTEM_TENANT_ID);

    const { token } = signVerificationToken(seed.id, 60, verifySecret);
    const res = await post("/api/auth/verify-email", { token });
    expect(res.status).toBe(200);

    const row = (await selectMany(stack.db, userTable)).find((r) => r["id"] === seed.id);
    expect(row?.["emailVerified"]).toBe(true);
  });

  test("direct-inserted user with no stream + no membership → 422 (recovery stays bounded)", async () => {
    // 205#1 "strikt sicher" boundary: a user inserted straight into the read
    // model (no create-event → no event stream) with no membership has
    // nothing to recover → invalidToken. Proves the fix only gains "empty
    // memberships + recoverable stream", never blanket-opens zero-membership.
    // Build a fully-populated user row with NO event stream: seed a normal
    // user (gets all NOT-NULL columns), capture its row, then re-key it to a
    // fresh id + email. getUnscopedAggregateStreamTenant(orphanId) finds no events
    // (the stream lives under the original id), and no membership is seeded
    // → tenantOrder is empty.
    const donor = await seedUser({ email: "donor@example.com", password: "donor-pw-1234" });
    const donorRow = (await selectMany(stack.db, userTable)).find((r) => r["id"] === donor.id);
    if (!donorRow) throw new Error("donor row missing");
    await asRawClient(stack.db).unsafe(`DELETE FROM "${tenantMembershipsTable.tableName}"`);

    const orphanId = "00000000-0000-4000-8000-0000000000ff";
    await seedRow(stack.db, userTable, {
      ...donorRow,
      id: orphanId,
      email: "orphan@example.com",
    });

    const { token } = signVerificationToken(orphanId, 60, verifySecret);
    const res = await post("/api/auth/verify-email", { token });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error?.details?.reason).toBe(AuthErrors.invalidVerificationToken);
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

describe("verify-email — aggregate stream in a non-membership tenant (sysadmin pattern)", () => {
  test("user whose aggregate stream lives in a tenant they are NOT a member of still verifies", async () => {
    // Prod sysadmin repro: the user aggregate is created via `systemAdmin`,
    // so its event stream lives in systemAdmin.tenantId (…0001), while the
    // user's ONLY membership is on a different tenant (…0002). resolveStream-
    // Tenants must discover the real stream tenant from the event log — if it
    // only tried membership tenants, every write would target …0002, get a
    // version_conflict, collapse to all_conflicts → invalid_verification_token.
    const membershipTenant = "00000000-0000-4000-8000-000000000002" as TenantId;
    const seed = await seedUser({
      email: "sysadmin-pattern@example.com",
      password: "pw-sysadmin-pat-1234",
      tenantId: membershipTenant,
    });

    const streamRows = (await asRawClient(stack.db).unsafe(
      `SELECT "tenant_id", "aggregate_type" FROM "kumiko_events" WHERE "aggregate_id" = $1 ORDER BY "version" LIMIT 1`,
      [seed.id],
    )) as ReadonlyArray<{ tenant_id: string; aggregate_type: string }>;
    expect(streamRows[0]?.aggregate_type).toBe("user");
    expect(streamRows[0]?.tenant_id).toBe(SYSTEM_TENANT_ID);
    expect(streamRows[0]?.tenant_id).not.toBe(membershipTenant);

    const { token } = signVerificationToken(seed.id, 60, verifySecret);
    const res = await post("/api/auth/verify-email", { token });
    expect(res.status).toBe(200);

    const row = (await selectMany(stack.db, userTable)).find((r) => r["id"] === seed.id);
    expect(row?.["emailVerified"]).toBe(true);
  });
});
