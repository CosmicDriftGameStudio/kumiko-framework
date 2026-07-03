import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import {
  createInMemoryLoginRateLimiter,
  type PatResolver,
} from "@cosmicdrift/kumiko-framework/api";
import { updateMany } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  configureBlindIndexKey,
  configurePiiSubjectKms,
  encryptPiiFieldValues,
  InMemoryKmsAdapter,
  isPiiCiphertext,
  resetBlindIndexKeyForTests,
  resetPiiSubjectKmsForTests,
} from "@cosmicdrift/kumiko-framework/crypto";
import type { SessionUser, TenantId } from "@cosmicdrift/kumiko-framework/engine";
import {
  setupTestStack,
  type TestStack,
  testTenantId,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import { createTestEnvelopeCipher, deleteRows } from "@cosmicdrift/kumiko-framework/testing";
import { Temporal } from "temporal-polyfill";
import { AuthHandlers } from "../../auth-email-password/constants";
import { createAuthEmailPasswordFeature } from "../../auth-email-password/feature";
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
import { createUserFeature } from "../../user/feature";
import { userEntity } from "../../user/schema/user";
import { PatHandlers, PatQueries } from "../constants";
import { createPersonalAccessTokensFeature } from "../feature";
import { createPatResolver } from "../resolver";
import { apiTokenEntity, apiTokenTable } from "../schema/api-token";
import type { PatScopeConfig } from "../scopes";

// Full loop, no mocks: mint a PAT via the create handler → use it as a bearer
// token over real HTTP. The resolver hashes it, resolves live roles, and the
// API boundary enforces the granted scopes. Proves the security matrix:
// allowed → 200, out-of-scope → 403 (while a JWT user could call it),
// revoked/expired/unknown/membership-removed → 401.

let stack: TestStack;
let h: ReturnType<typeof makeSessionHelpers>;
let patResolver: PatResolver | undefined;

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
  opts?: { scopes?: string[]; expiresInDays?: number },
): Promise<string> {
  const res = await stack.http.writeOk<{ id: string; token: string }>(
    PatHandlers.create,
    {
      name: "test",
      scopes: opts?.scopes ?? ["tokens:read"],
      ...(opts?.expiresInDays ? { expiresInDays: opts.expiresInDays } : {}),
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
      createPersonalAccessTokensFeature({ scopes: SCOPES }),
    ],
    extraContext: { configResolver: resolver, configEncryption: encryption },
    authConfig: {
      membershipQuery: "tenant:query:memberships",
      loginHandler: AuthHandlers.login,
      patResolver: (raw: string) => {
        if (!patResolver) throw new Error("resolver not set");
        return patResolver(raw);
      },
      // Low per-token cap so the rate-limit test can exhaust it. Other tests do
      // ≤2 requests per (distinct) token, so this ceiling never trips them.
      patRateLimiter: createInMemoryLoginRateLimiter(3, 60_000),
    },
  });
  patResolver = createPatResolver({ db: stack.db, scopes: SCOPES });
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
});

describe("PAT with active KMS (#818): token name is userOwned PII", () => {
  // create.write schreibt heute noch via direct insertOne (ES-Bypass) →
  // Klartext at rest. Der list-Reader muss BEIDE Zustände liefern können:
  // Klartext-Bestand pass-through, Ciphertext (kuenftiger Executor-Write
  // bzw. Backfill) decrypted.
  test("list decrypts an encrypted name and passes plaintext rows through", async () => {
    const kms = new InMemoryKmsAdapter();
    configurePiiSubjectKms(kms);
    configureBlindIndexKey(Buffer.alloc(32, 7).toString("base64"));
    try {
      const actor = await actorFor("kms-pat@example.com");
      await mintToken(actor);

      const rows = await stack.http.queryOk<Array<{ id: string; name: string }>>(
        PatQueries.mine,
        {},
        actor,
      );
      expect(rows[0]?.name).toBe("test");

      const encrypted = await encryptPiiFieldValues(
        { userId: actor.id, name: "test" },
        apiTokenEntity,
        ["name"],
        kms,
        { requestId: "test" },
      );
      expect(isPiiCiphertext(encrypted["name"])).toBe(true);
      await updateMany(stack.db, apiTokenTable, { name: encrypted["name"] }, { id: rows[0]?.id });

      const rows2 = await stack.http.queryOk<Array<{ id: string; name: string }>>(
        PatQueries.mine,
        {},
        actor,
      );
      expect(rows2[0]?.name).toBe("test");
    } finally {
      resetPiiSubjectKmsForTests();
      resetBlindIndexKeyForTests();
    }
  });
});
