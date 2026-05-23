import { randomBytes } from "node:crypto";
import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";
import { createEncryptionProvider } from "@cosmicdrift/kumiko-framework/db";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import {
  setupTestStack,
  type TestStack,
  TestUsers,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import * as jose from "jose";
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

// In-memory fake of a real sessions-store — just enough to observe that the
// framework calls the callbacks at the right moments and threads the sid back
// through the JWT. The real sessions feature will persist to a table; this
// test cares only about the wiring.
type FakeStore = {
  live: Set<string>;
  created: Array<{ sid: string; userId: string; tenantId: TenantId; ip: string; ua: string }>;
  revoked: string[];
};

function createFakeStore(): FakeStore {
  return { live: new Set(), created: [], revoked: [] };
}

function createSessionCallbacks(
  store: FakeStore,
  idStream: Iterator<string>,
): {
  sessionCreator: (
    user: { id: string; tenantId: TenantId },
    meta: { ip: string; userAgent: string },
  ) => Promise<string>;
  sessionRevoker: (sid: string) => Promise<void>;
} {
  return {
    async sessionCreator(user, meta) {
      const next = idStream.next();
      if (next.done) throw new Error("ran out of deterministic sids");
      const sid = next.value;
      store.live.add(sid);
      store.created.push({
        sid,
        userId: user.id,
        tenantId: user.tenantId,
        ip: meta.ip,
        ua: meta.userAgent,
      });
      return sid;
    },
    async sessionRevoker(sid) {
      store.live.delete(sid);
      store.revoked.push(sid);
    },
  };
}

function* deterministicSids(): Generator<string> {
  let i = 1;
  while (true) {
    yield `sid-${String(i).padStart(4, "0")}`;
    i++;
  }
}

let stack: TestStack;
let store: FakeStore;
let sidStream: Generator<string>;

const systemAdmin = TestUsers.systemAdmin;
const encryptionKey = randomBytes(32).toString("base64");

const TENANT_A: TenantId = "00000000-0000-4000-8000-0000000000a1";
const TENANT_B: TenantId = "00000000-0000-4000-8000-0000000000b1";

beforeAll(async () => {
  const encryption = createEncryptionProvider(encryptionKey);
  const resolver = createConfigResolver({ encryption });

  store = createFakeStore();
  sidStream = deterministicSids();
  const callbacks = createSessionCallbacks(store, sidStream);

  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createUserFeature(),
      createTenantFeature(),
      createAuthEmailPasswordFeature(),
    ],
    extraContext: { configResolver: resolver, configEncryption: encryption },
    authConfig: {
      membershipQuery: "tenant:query:memberships",
      loginHandler: AuthHandlers.login,
      loginErrorStatusMap: {
        [AuthErrors.invalidCredentials]: 401,
        [AuthErrors.noMembership]: 403,
      },
      sessionCreator: callbacks.sessionCreator,
      sessionRevoker: callbacks.sessionRevoker,
    },
  });

  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafeCreateEntityTable(stack.db, tenantEntity);
  await unsafePushTables(stack.db, { configValuesTable, tenantMembershipsTable });
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await asRawClient(stack.db).unsafe(`DELETE FROM "${userTable.tableName}"`);
  await asRawClient(stack.db).unsafe(`DELETE FROM "${tenantMembershipsTable.tableName}"`);
  // Reset the in-memory store but KEEP sidStream running — otherwise a test
  // that leaks a sid into another test would produce confusing collisions.
  store.live.clear();
  store.created.length = 0;
  store.revoked.length = 0;
});

async function seedUser(opts: {
  email: string;
  password: string;
  tenants: { id: TenantId; roles: string[] }[];
}): Promise<{ userId: string }> {
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
  for (const t of opts.tenants) {
    await seedTenantMembership(stack.db, {
      userId: created.id,
      tenantId: t.id,
      roles: t.roles,
    });
  }
  return { userId: created.id };
}

async function login(email: string, password: string, headers?: Record<string, string>) {
  const res = await stack.http.raw("POST", "/api/auth/login", { email, password }, headers);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { token: string; user: { id: string; tenantId: TenantId } };
  return body;
}

// Pure decode — we only care about the payload shape, not signature validity,
// because the auth-middleware is the one that checks the signature. Using
// jose.decodeJwt keeps the test from needing the secret.
function decode(token: string): { sub: string; jti?: string; tenantId: TenantId } {
  const payload = jose.decodeJwt(token);
  const result: { sub: string; jti?: string; tenantId: TenantId } = {
    sub: payload.sub ?? "",
    tenantId: payload["tenantId"] as TenantId,
  };
  if (typeof payload.jti === "string") result.jti = payload.jti;
  return result;
}

// --- scenario 1: login goes through sessionCreator + carries jti ---

describe("login wires into sessionCreator and embeds jti", () => {
  test("login creates a session, and the JWT carries that sid in its jti claim", async () => {
    const { userId } = await seedUser({
      email: "first@example.com",
      password: "correct-horse-battery",
      tenants: [{ id: TENANT_A, roles: ["User"] }],
    });

    const res = await login("first@example.com", "correct-horse-battery", {
      "x-forwarded-for": "198.51.100.42",
      "user-agent": "Mozilla/5.0 SessionTest",
    });

    // Creator was invoked exactly once with the right user + meta
    expect(store.created).toHaveLength(1);
    expect(store.created[0]).toMatchObject({
      userId,
      tenantId: TENANT_A,
      ip: "198.51.100.42",
      ua: "Mozilla/5.0 SessionTest",
    });

    // The sid ended up in the JWT's jti claim
    const decoded = decode(res.token);
    expect(decoded.jti).toBe(store.created[0]?.sid);
    expect(decoded.sub).toBe(userId);

    // And the session is live on the server side
    expect(store.live.has(decoded.jti ?? "")).toBe(true);
  });
});

// --- scenario 2: logout revokes the session via the revoker callback ---

describe("logout routes through sessionRevoker", () => {
  test("POST /auth/logout deletes the sid carried by the caller's JWT", async () => {
    await seedUser({
      email: "logout@example.com",
      password: "bye-bye-session",
      tenants: [{ id: TENANT_A, roles: ["User"] }],
    });

    const loginRes = await login("logout@example.com", "bye-bye-session");
    const sidBefore = decode(loginRes.token).jti;
    expect(sidBefore).toBeDefined();
    expect(store.live.has(sidBefore ?? "")).toBe(true);

    const logoutRes = await stack.http.raw("POST", "/api/auth/logout", undefined, {
      Authorization: `Bearer ${loginRes.token}`,
    });
    expect(logoutRes.status).toBe(200);

    // Revoker was called with exactly the sid from the caller's JWT
    expect(store.revoked).toEqual([sidBefore]);
    expect(store.live.has(sidBefore ?? "")).toBe(false);
  });

  test("logout without a bearer token → 401 (middleware blocks it)", async () => {
    const res = await stack.http.raw("POST", "/api/auth/logout");
    expect(res.status).toBe(401);
    expect(store.revoked).toHaveLength(0);
  });
});

// --- scenario 3: switch-tenant rotates the sid (old revoked, new created) ---

describe("switch-tenant rotates the session", () => {
  test("switching from A → B revokes the A-sid and creates a B-sid, in that order", async () => {
    await seedUser({
      email: "switcher@example.com",
      password: "multi-tenant-life",
      tenants: [
        { id: TENANT_A, roles: ["User"] },
        { id: TENANT_B, roles: ["Admin"] },
      ],
    });

    const first = await login("switcher@example.com", "multi-tenant-life");
    const sidA = decode(first.token).jti;
    expect(sidA).toBeDefined();

    // Ask to switch to tenant B
    const switchRes = await stack.http.raw(
      "POST",
      "/api/auth/switch-tenant",
      { tenantId: TENANT_B },
      { Authorization: `Bearer ${first.token}` },
    );
    expect(switchRes.status).toBe(200);
    const switched = (await switchRes.json()) as { token: string; tenantId: TenantId };
    expect(switched.tenantId).toBe(TENANT_B);

    const sidB = decode(switched.token).jti;
    expect(sidB).toBeDefined();
    expect(sidB).not.toBe(sidA);

    // Old sid is revoked; new sid is live
    expect(store.revoked).toContain(sidA);
    expect(store.live.has(sidA ?? "")).toBe(false);
    expect(store.live.has(sidB ?? "")).toBe(true);

    // The B-session was created with tenant B on the user object — that's the
    // whole point of running claims under the new tenant scope, so let's pin it.
    const createdB = store.created.find((c) => c.sid === sidB);
    expect(createdB?.tenantId).toBe(TENANT_B);
  });
});

// --- scenario 4: meta forwarding — missing headers fall back to "unknown" ---

describe("sessionMetadata falls back to 'unknown' on missing headers", () => {
  test("no x-forwarded-for and no user-agent → both default to 'unknown'", async () => {
    await seedUser({
      email: "anon@example.com",
      password: "hdr-less",
      tenants: [{ id: TENANT_A, roles: ["User"] }],
    });

    // The test helper still injects Content-Type but not forwarded-for or UA.
    await login("anon@example.com", "hdr-less");

    const created = store.created.at(-1);
    expect(created?.ip).toBe("unknown");
    expect(created?.ua).toBe("unknown");
  });
});
