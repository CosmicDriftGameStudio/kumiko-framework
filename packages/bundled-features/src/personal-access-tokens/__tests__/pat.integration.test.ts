import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { createInMemoryLoginRateLimiter } from "@cosmicdrift/kumiko-framework/api";
import { selectMany, updateMany } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  configureBlindIndexKey,
  configurePiiSubjectKms,
  InMemoryKmsAdapter,
  isPiiCiphertext,
} from "@cosmicdrift/kumiko-framework/crypto";
import type { SessionUser, TenantId } from "@cosmicdrift/kumiko-framework/engine";
import {
  setupTestStack,
  type TestStack,
  testTenantId,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import {
  createTestEnvelopeCipher,
  deleteRows,
  resetBlindIndexKeyForTests,
  resetPiiSubjectKmsForTests,
  updateRows,
} from "@cosmicdrift/kumiko-framework/testing";
import { Temporal } from "temporal-polyfill";
import { AuthHandlers } from "../../auth-email-password/constants";
import { createAuthEmailPasswordFeature } from "../../auth-email-password/feature";
import { authFoundationFeature, resolveTokenVerifier } from "../../auth-foundation";
import { createConfigFeature } from "../../config";
import { createConfigResolver } from "../../config/resolver";
import { configValuesTable } from "../../config/table";
import { makeSessionHelpers } from "../../sessions/__tests__/test-helpers";
import { SessionQueries } from "../../sessions/constants";
import { createSessionsFeature } from "../../sessions/feature";
import { userSessionEntity } from "../../sessions/schema/user-session";
import { createTenantFeature } from "../../tenant";
import { tenantMembershipsTable } from "../../tenant/membership-table";
import { tenantEntity } from "../../tenant/schema/tenant";
import { USER_STATUS, UserHandlers, UserQueries } from "../../user";
import { createUserFeature } from "../../user/feature";
import { userEntity, userTable } from "../../user/schema/user";
import { PAT_DEFAULT_EXPIRES_IN_DAYS, PatErrors, PatHandlers, PatQueries } from "../constants";
import { createPersonalAccessTokensFeature } from "../feature";
import { revokeAllPatTokensForUser } from "../revoke-for-user";
import { apiTokenEntity, apiTokenTable } from "../schema/api-token";
import type { PatScopeConfig } from "../scopes";

// Full loop, no mocks: mint a PAT via the create handler → use it as a bearer
// token over real HTTP. The resolver hashes it, resolves live roles, and the
// API boundary enforces the granted scopes. Proves the security matrix:
// allowed → 200, out-of-scope → 403 (while a JWT user could call it),
// revoked/expired/unknown/membership-removed → 401.

let stack: TestStack;
let h: ReturnType<typeof makeSessionHelpers>;

const encryptionKey = randomBytes(32).toString("base64");
const TENANT: TenantId = testTenantId(1);

// One domain "tokens" whose read set is exactly the two PAT queries —
// deliberately NOT sessions:query:user-session:mine, so that QN is the
// out-of-scope probe. Granted as "tokens:read".
const SCOPES: PatScopeConfig = {
  tokens: { label: "Tokens", read: [PatQueries.mine, PatQueries.availableScopes] },
};

async function mintToken(
  actor: SessionUser,
  opts?: {
    scopes?: string[];
    expiresInDays?: number;
    currentPassword?: string;
    mfaCode?: string;
  },
): Promise<string> {
  const res = await stack.http.writeOk<{ id: string; token: string }>(
    PatHandlers.create,
    {
      name: "test",
      scopes: opts?.scopes ?? ["tokens:read"],
      currentPassword: opts?.currentPassword ?? "pw",
      ...(opts?.expiresInDays ? { expiresInDays: opts.expiresInDays } : {}),
      ...(opts?.mfaCode ? { mfaCode: opts.mfaCode } : {}),
    },
    actor,
  );
  return res.token;
}

beforeAll(async () => {
  const encryption = createTestEnvelopeCipher(encryptionKey);
  const resolver = createConfigResolver({ cipher: encryption });

  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createUserFeature(),
      createTenantFeature(),
      createAuthEmailPasswordFeature(),
      createSessionsFeature(),
      createPersonalAccessTokensFeature({
        scopes: SCOPES,
        // Closure over `stack` is fine here: the hook only invokes this at
        // fire-time, well after setupTestStack below has assigned it.
        autoRevokeOnPasswordChange: (userId) => revokeAllPatTokensForUser(stack.db, userId),
      }),
      authFoundationFeature,
    ],
    extraContext: { configResolver: resolver, configEncryption: encryption },
    authConfig: {
      membershipQuery: "tenant:query:memberships",
      loginHandler: AuthHandlers.login,
      // PAT registers itself as a tokenVerifier provider (auth-foundation)
      // instead of the app wiring a dedicated patResolver — resolved
      // generically here, same as run-prod-app/run-dev-app do.
      tokenVerifier: (raw: string) =>
        resolveTokenVerifier({ db: stack.db, registry: stack.registry }, raw),
      // Low per-token cap so the rate-limit test can exhaust it. Other tests do
      // ≤2 requests per (distinct) token, so this ceiling never trips them.
      patRateLimiter: createInMemoryLoginRateLimiter(3, 60_000),
    },
  });
  h = makeSessionHelpers(stack, TENANT);

  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafeCreateEntityTable(stack.db, tenantEntity);
  await unsafeCreateEntityTable(stack.db, userSessionEntity);
  await unsafeCreateEntityTable(stack.db, apiTokenEntity);
  await unsafePushTables(stack.db, { configValuesTable, tenantMembershipsTable });
});

afterAll(async () => {
  await stack.cleanup();
});

async function actorFor(email: string): Promise<SessionUser> {
  const { userId } = await h.seedUser(email, "pw");
  return { id: userId, tenantId: TENANT, roles: ["User"] };
}

// Raw login → JWT (no sid: session callbacks aren't wired here, and the PAT
// path doesn't need them). Used only to prove a non-PAT bearer skips the gate.
async function loginToken(email: string): Promise<string> {
  const res = await stack.http.raw("POST", "/api/auth/login", { email, password: "pw" });
  expect(res.status).toBe(200);
  return ((await res.json()) as { token: string }).token;
}

describe("PAT auth", () => {
  test("granted scope → 200", async () => {
    const actor = await actorFor("granted@example.com");
    const token = await mintToken(actor);
    const res = await h.authedPost("/api/query", token, { type: PatQueries.mine, payload: {} });
    expect(res.status).toBe(200);
  });

  test("out-of-scope QN → 403 (but a JWT user may call it)", async () => {
    const actor = await actorFor("scope@example.com");
    const token = await mintToken(actor);
    const denied = await h.authedPost("/api/query", token, {
      type: SessionQueries.mine,
      payload: {},
    });
    expect(denied.status).toBe(403);

    const jwt = await loginToken("scope@example.com");
    const allowed = await h.authedPost("/api/query", jwt, {
      type: SessionQueries.mine,
      payload: {},
    });
    expect(allowed.status).toBe(200);
  });

  test("unknown token → 401", async () => {
    const res = await h.authedPost("/api/query", "kpat_deadbeef", {
      type: PatQueries.mine,
      payload: {},
    });
    expect(res.status).toBe(401);
  });

  test("revoked token → 401", async () => {
    const actor = await actorFor("revoked@example.com");
    const token = await mintToken(actor);
    const rows = await stack.http.queryOk<Array<{ id: string }>>(PatQueries.mine, {}, actor);
    const id = rows[0]?.id;
    expect(id).toBeDefined();
    await stack.http.writeOk(PatHandlers.revoke, { id }, actor);
    const res = await h.authedPost("/api/query", token, { type: PatQueries.mine, payload: {} });
    expect(res.status).toBe(401);
  });

  test("expired token → 401", async () => {
    const actor = await actorFor("expired@example.com");
    const token = await mintToken(actor);
    const past = Temporal.Now.instant().subtract({ hours: 1 });
    const rows =
      (await stack.http.queryOk<Array<{ id: string }>>(PatQueries.mine, {}, actor)) ?? [];
    await updateMany(stack.db, apiTokenTable, { expiresAt: past }, { id: rows[0]?.id });
    const res = await h.authedPost("/api/query", token, { type: PatQueries.mine, payload: {} });
    expect(res.status).toBe(401);
  });

  test("per-token rate limit → 429 once the cap is exceeded", async () => {
    const actor = await actorFor("ratelimit@example.com");
    const token = await mintToken(actor);
    for (let i = 0; i < 3; i++) {
      const ok = await h.authedPost("/api/query", token, { type: PatQueries.mine, payload: {} });
      expect(ok.status).toBe(200);
    }
    const limited = await h.authedPost("/api/query", token, { type: PatQueries.mine, payload: {} });
    expect(limited.status).toBe(429);
  });

  test("membership removed → 401 (live roles, no snapshot)", async () => {
    const actor = await actorFor("removed@example.com");
    const token = await mintToken(actor);
    const ok = await h.authedPost("/api/query", token, { type: PatQueries.mine, payload: {} });
    expect(ok.status).toBe(200);
    // tenantMembershipsTable is ES-managed (executor-only branded); deleteRows
    // is the test-side escape for out-of-band row removal.
    await deleteRows(stack.db, tenantMembershipsTable, { userId: actor.id });
    const res = await h.authedPost("/api/query", token, { type: PatQueries.mine, payload: {} });
    expect(res.status).toBe(401);
  });

  test("user status Deleted → 401 (blocked principal, same as an unknown token)", async () => {
    const actor = await actorFor("deleted-status@example.com");
    const token = await mintToken(actor);
    const ok = await h.authedPost("/api/query", token, { type: PatQueries.mine, payload: {} });
    expect(ok.status).toBe(200);

    await updateRows(stack.db, userTable, { status: USER_STATUS.Deleted }, { id: actor.id });
    const res = await h.authedPost("/api/query", token, { type: PatQueries.mine, payload: {} });
    expect(res.status).toBe(401);
  });
});

describe("PAT with active KMS (#820): token name is userOwned PII", () => {
  test("create stores ciphertext at rest, list returns the plaintext name", async () => {
    configurePiiSubjectKms(new InMemoryKmsAdapter());
    configureBlindIndexKey(Buffer.alloc(32, 7).toString("base64"));
    try {
      const actor = await actorFor("kms-pat@example.com");
      const token = await mintToken(actor);

      const rows = await stack.http.queryOk<Array<{ id: string; name: string }>>(
        PatQueries.mine,
        {},
        actor,
      );
      expect(rows[0]?.name).toBe("test");

      const stored = await selectMany<{ name: string }>(stack.db, apiTokenTable, {
        id: rows[0]?.id,
      });
      expect(isPiiCiphertext(stored[0]?.name)).toBe(true);

      // Der Token selbst funktioniert weiter (resolver liest tokenHash, nie name).
      const res = await h.authedPost("/api/query", token, { type: PatQueries.mine, payload: {} });
      expect(res.status).toBe(200);
    } finally {
      resetPiiSubjectKmsForTests();
      resetBlindIndexKeyForTests();
    }
  });
});

describe("PAT create: re-auth (#security)", () => {
  test("missing currentPassword → rejected, no token minted", async () => {
    const actor = await actorFor("reauth-missing@example.com");
    const err = await stack.http.writeErr(
      PatHandlers.create,
      { name: "test", scopes: ["tokens:read"] },
      actor,
    );
    expect(err.httpStatus).toBeGreaterThanOrEqual(400);
    const rows = await stack.http.queryOk<Array<{ id: string }>>(PatQueries.mine, {}, actor);
    expect(rows).toHaveLength(0);
  });

  test("wrong currentPassword → rejected, no token minted", async () => {
    const actor = await actorFor("reauth-wrong@example.com");
    const err = await stack.http.writeErr(
      PatHandlers.create,
      { name: "test", scopes: ["tokens:read"], currentPassword: "not-the-password" },
      actor,
    );
    expect(err.details).toMatchObject({ reason: PatErrors.reauthRequired });
    const rows = await stack.http.queryOk<Array<{ id: string }>>(PatQueries.mine, {}, actor);
    expect(rows).toHaveLength(0);
  });

  test("expiresInDays omitted → defaults to ~90 days, not never-expiring", async () => {
    const actor = await actorFor("reauth-expiry@example.com");
    await mintToken(actor);
    const rows = await stack.http.queryOk<Array<{ id: string; expiresAt: string | null }>>(
      PatQueries.mine,
      {},
      actor,
    );
    expect(rows[0]?.expiresAt).not.toBeNull();
    const expiresAt = Temporal.Instant.from(rows[0]?.expiresAt as string);
    const expected = Temporal.Now.instant().add({ hours: 24 * PAT_DEFAULT_EXPIRES_IN_DAYS });
    const driftHours = Math.abs(expiresAt.since(expected).total({ unit: "hours" }));
    expect(driftHours).toBeLessThan(1);
  });
});

describe("PAT create: MFA re-auth gate", () => {
  let mfaStack: TestStack;
  let mfaH: ReturnType<typeof makeSessionHelpers>;

  beforeAll(async () => {
    const encryption = createTestEnvelopeCipher(encryptionKey);
    const resolver = createConfigResolver({ cipher: encryption });
    mfaStack = await setupTestStack({
      features: [
        createConfigFeature(),
        createUserFeature(),
        createTenantFeature(),
        createAuthEmailPasswordFeature(),
        createSessionsFeature(),
        createPersonalAccessTokensFeature({
          scopes: SCOPES,
          // Stub verifier: always enrolled, code never accepted — exercises
          // the real gate over HTTP without depending on auth-mfa's TOTP
          // machinery (same shape as sessions' massRevokeSpy tests).
          mfaVerifier: async () => ({ enrolled: true, ok: false }),
        }),
        authFoundationFeature,
      ],
      extraContext: { configResolver: resolver, configEncryption: encryption },
      authConfig: {
        membershipQuery: "tenant:query:memberships",
        loginHandler: AuthHandlers.login,
        tokenVerifier: (raw: string) =>
          resolveTokenVerifier({ db: mfaStack.db, registry: mfaStack.registry }, raw),
        patRateLimiter: createInMemoryLoginRateLimiter(10, 60_000),
      },
    });
    mfaH = makeSessionHelpers(mfaStack, TENANT);
    await unsafeCreateEntityTable(mfaStack.db, userEntity);
    await unsafeCreateEntityTable(mfaStack.db, tenantEntity);
    await unsafeCreateEntityTable(mfaStack.db, userSessionEntity);
    await unsafeCreateEntityTable(mfaStack.db, apiTokenEntity);
    await unsafePushTables(mfaStack.db, { configValuesTable, tenantMembershipsTable });
  });

  afterAll(async () => {
    await mfaStack.cleanup();
  });

  test("MFA-enrolled user without mfaCode → rejected, no token minted", async () => {
    const { userId } = await mfaH.seedUser("mfa-missing-code@example.com", "pw");
    const actor: SessionUser = { id: userId, tenantId: TENANT, roles: ["User"] };
    const err = await mfaStack.http.writeErr(
      PatHandlers.create,
      { name: "test", scopes: ["tokens:read"], currentPassword: "pw" },
      actor,
    );
    expect(err.details).toMatchObject({ reason: PatErrors.reauthRequired });
    const rows = await mfaStack.http.queryOk<Array<{ id: string }>>(PatQueries.mine, {}, actor);
    expect(rows).toHaveLength(0);
  });

  test("MFA-enrolled user with wrong mfaCode → rejected, no token minted", async () => {
    const { userId } = await mfaH.seedUser("mfa-wrong-code@example.com", "pw");
    const actor: SessionUser = { id: userId, tenantId: TENANT, roles: ["User"] };
    const err = await mfaStack.http.writeErr(
      PatHandlers.create,
      { name: "test", scopes: ["tokens:read"], currentPassword: "pw", mfaCode: "000000" },
      actor,
    );
    expect(err.details).toMatchObject({ reason: PatErrors.reauthRequired });
    const rows = await mfaStack.http.queryOk<Array<{ id: string }>>(PatQueries.mine, {}, actor);
    expect(rows).toHaveLength(0);
  });
});

describe("PAT revoke on password change (#security)", () => {
  test("changing password revokes all of the user's live PAT tokens", async () => {
    const actor = await actorFor("pat-revoke-pwchange@example.com");
    const token = await mintToken(actor);
    const preCheck = await h.authedPost("/api/query", token, {
      type: PatQueries.mine,
      payload: {},
    });
    expect(preCheck.status).toBe(200);

    await stack.http.writeOk(
      AuthHandlers.changePassword,
      { oldPassword: "pw", newPassword: "NewPassw0rd!42" },
      actor,
    );

    const rows = await selectMany<{ revokedAt: string | null }>(stack.db, apiTokenTable, {
      userId: actor.id,
    });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.revokedAt !== null)).toBe(true);

    const res = await h.authedPost("/api/query", token, { type: PatQueries.mine, payload: {} });
    expect(res.status).toBe(401);
  });

  test("editing a non-password field does NOT revoke PAT tokens", async () => {
    const actor = await actorFor("pat-no-revoke-other-field@example.com");
    const token = await mintToken(actor);

    const me = await stack.http.queryOk<{ version: number }>(UserQueries.me, {}, actor);
    await stack.http.writeOk(
      UserHandlers.update,
      { id: actor.id, version: me.version, changes: { displayName: "New Name" } },
      actor,
    );

    const res = await h.authedPost("/api/query", token, { type: PatQueries.mine, payload: {} });
    expect(res.status).toBe(200);
  });
});
