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
import { createTestEnvelopeCipher, seedRow } from "@cosmicdrift/kumiko-framework/testing";
import { Temporal } from "temporal-polyfill";
import { createChannelEmailFeature, createInMemoryTransport } from "../../channel-email";
import { createConfigFeature } from "../../config";
import { createConfigResolver } from "../../config/resolver";
import { configValuesTable } from "../../config/table";
import { createDeliveryFeature, createDeliveryTestContext } from "../../delivery";
import { notificationPreferencesTable } from "../../delivery/tables";
import { createRendererFoundationFeature } from "../../renderer-foundation/feature";
import { createRendererSimpleFeature, simpleRenderer } from "../../renderer-simple";
import { createSessionsFeature, userSessionTable } from "../../sessions";
import { hashPassword, verifyPassword } from "../../shared";
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

// Reset mails now go through delivery (ctx.notify → channel-email). The
// in-memory transport captures what would be sent; route:{email} delivers
// directly (no jobRunner in the test stack → inline send).
const emailTransport = createInMemoryTransport();

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
        // route:{email} delivers directly — resolveEmail (userId→address) is
        // never hit by the reset flow, but the channel requires it.
        resolveEmail: async () => "unused@test.local",
      }),
      createAuthEmailPasswordFeature({
        passwordReset: { hmacSecret: resetSecret, tokenTtlMinutes: 15, appUrl: appResetUrl },
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
    extraContext: (deps) => ({
      ...createDeliveryTestContext(deps),
      configResolver: resolver,
      configEncryption: encryption,
    }),
    authConfig: {
      membershipQuery: "tenant:query:memberships",
      loginHandler: AuthHandlers.login,
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
    userSessionTable,
    notificationPreferencesTable,
  });
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await asRawClient(stack.db).unsafe(`DELETE FROM "${userTable.tableName}"`);
  await asRawClient(stack.db).unsafe(`DELETE FROM "${tenantMembershipsTable.tableName}"`);
  await asRawClient(stack.db).unsafe(`DELETE FROM "${userSessionTable.tableName}"`);
  emailTransport.sent.length = 0;
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
  test("known email → 200, delivery sends mail with reset URL", async () => {
    await seedUser({ email: "alice@example.com", password: "initial-pw!" });

    const res = await post("/api/auth/request-password-reset", { email: "alice@example.com" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ isSuccess: true });
    expect(emailTransport.sent).toHaveLength(1);
    const sent = emailTransport.sent[0];
    if (!sent) throw new Error("no email sent");
    expect(sent.to).toBe("alice@example.com");
    expect(sent.subject).toContain("Reset");
    expect(sent.html).toContain(`${appResetUrl}?token=`);
  });

  test("unknown email → 200 with NO mail sent (enumeration-safe)", async () => {
    const res = await post("/api/auth/request-password-reset", { email: "ghost@example.com" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ isSuccess: true });
    expect(emailTransport.sent).toHaveLength(0);
  });

  test("malformed body → 200 (silent success, no enumeration via error shape)", async () => {
    const res = await post("/api/auth/request-password-reset", { wrong: "shape" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ isSuccess: true });
    expect(emailTransport.sent).toHaveLength(0);
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
    const row = (await selectMany(stack.db, userTable)).find((r) => r["id"] === seed.id);
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
    const row = (await selectMany(stack.db, userTable)).find((r) => r["id"] === seed.id);
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
    // can't slip through. But if the state change itself fails — DB error,
    // user-row vanished, every tenant stream rejected — the token was never
    // actually consumed. The handler releases the burn in those branches so
    // the user can click the link again once ops restores state.
    //
    // Repro: delete the user READ-MODEL row (kumiko_events untouched) →
    // loadValidatedUser returns null AFTER the burn → invalidToken + unburn.
    // Re-insert the same row verbatim (restores version → optimistic write
    // still matches the untouched event stream) → second attempt with the
    // SAME token succeeds, proving the burn was released.
    //
    // (Deleting the membership no longer works as a failure trigger: the
    // user aggregate stream lives in systemAdmin.tenantId and is recovered
    // by resolveStreamTenants even with zero memberships — see the
    // zero-membership-sysadmin test below.)
    const seed = await seedUser({ email: "retry@example.com", password: "pw-retry-1234" });
    const { token } = signResetToken(seed.id, 15, resetSecret);

    const userRow = (await selectMany(stack.db, userTable)).find((r) => r["id"] === seed.id);
    if (!userRow) throw new Error("seeded user row missing");
    await asRawClient(stack.db).unsafe(`DELETE FROM "${userTable.tableName}" WHERE id = $1`, [
      seed.id,
    ]);

    const firstAttempt = await post("/api/auth/reset-password", {
      token,
      newPassword: "never-lands-1234",
    });
    expect(firstAttempt.status).toBe(422);

    // Re-insert the captured row verbatim. Same userId, same version, same
    // token still valid.
    await seedRow(stack.db, userTable, userRow);

    const secondAttempt = await post("/api/auth/reset-password", {
      token,
      newPassword: "finally-lands-1234",
    });
    expect(secondAttempt.status).toBe(200);
  });

  test("zero-membership sysadmin can still reset (stream recovered without any membership)", async () => {
    // 205#1: a systemScope user whose stream lives in systemAdmin.tenantId
    // (…0001) but who holds NO membership must still resolve. The stream-
    // tenant recovery in resolveStreamTenants runs BEFORE the empty-
    // membership check, so the reset targets …0001 and lands — instead of
    // collapsing to invalid_token. Mirrors change-password's unconditional
    // recovery.
    const seed = await seedUser({ email: "lonely-admin@example.com", password: "pw-old-lonely!" });
    await asRawClient(stack.db).unsafe(`DELETE FROM "${tenantMembershipsTable.tableName}"`);

    // Confirm the stream tenant the recovery must find: the user aggregate
    // was created via systemAdmin, so its stream lives in …0001.
    const streamRows = (await asRawClient(stack.db).unsafe(
      `SELECT "tenant_id" FROM "kumiko_events" WHERE "aggregate_id" = $1 AND "aggregate_type" = 'user' ORDER BY "version" LIMIT 1`,
      [seed.id],
    )) as ReadonlyArray<{ tenant_id: string }>;
    expect(streamRows[0]?.tenant_id).toBe(SYSTEM_TENANT_ID);

    const { token } = signResetToken(seed.id, 15, resetSecret);
    const res = await post("/api/auth/reset-password", {
      token,
      newPassword: "pw-new-lonely-1234",
    });
    expect(res.status).toBe(200);

    const row = (await selectMany(stack.db, userTable)).find((r) => r["id"] === seed.id);
    expect(await verifyPassword(row?.["passwordHash"] as string, "pw-new-lonely-1234")).toBe(true);
  });

  test("direct-inserted user with no stream + no membership → 422 (recovery stays bounded)", async () => {
    // 205#1 "strikt sicher" boundary: a user inserted straight into the read
    // model (no create-event → no event stream) with no membership has
    // nothing to recover. resolveStreamTenants returns [] → invalidToken.
    // Proves the fix only gains "empty memberships + recoverable stream",
    // never blanket-opens zero-membership.
    // Build a fully-populated user row with NO event stream: seed a normal
    // user (gets all NOT-NULL columns), capture its row, then re-key it to a
    // fresh id + email. getAggregateStreamTenant(orphanId) finds no events
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

    const { token } = signResetToken(orphanId, 15, resetSecret);
    const res = await post("/api/auth/reset-password", {
      token,
      newPassword: "should-not-land-1234",
    });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error?.details?.reason).toBe(AuthErrors.invalidResetToken);
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

  test("user whose aggregate stream lives in a tenant they are NOT a member of can still reset", async () => {
    // Mirror of the verify-email sysadmin repro: aggregate stream in …0001
    // (created via systemAdmin), only membership on …0002. The reset must
    // target the real stream tenant, not the membership tenant.
    const membershipTenant = "00000000-0000-4000-8000-000000000002" as TenantId;
    const seed = await seedUser({
      email: "sysadmin-reset@example.com",
      password: "pw-old-sysadmin-1234",
      tenantId: membershipTenant,
    });

    const streamRows = (await asRawClient(stack.db).unsafe(
      `SELECT "tenant_id", "aggregate_type" FROM "kumiko_events" WHERE "aggregate_id" = $1 ORDER BY "version" LIMIT 1`,
      [seed.id],
    )) as ReadonlyArray<{ tenant_id: string; aggregate_type: string }>;
    expect(streamRows[0]?.aggregate_type).toBe("user");
    expect(streamRows[0]?.tenant_id).toBe(SYSTEM_TENANT_ID);
    expect(streamRows[0]?.tenant_id).not.toBe(membershipTenant);

    const { token } = signResetToken(seed.id, 15, resetSecret);
    const res = await post("/api/auth/reset-password", {
      token,
      newPassword: "pw-new-sysadmin-1234",
    });
    expect(res.status).toBe(200);

    const row = (await selectMany(stack.db, userTable)).find((r) => r["id"] === seed.id);
    const valid = await verifyPassword(row?.["passwordHash"] as string, "pw-new-sysadmin-1234");
    expect(valid).toBe(true);
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
