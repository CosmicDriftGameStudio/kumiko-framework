import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";
import { createEncryptionProvider } from "@cosmicdrift/kumiko-framework/db";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import {
  setupTestStack,
  type TestStack,
  TestUsers,
  testTenantId,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import { seedRow } from "@cosmicdrift/kumiko-framework/testing";
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

// Sample-style extension feature that shows the real-world shape of a claims
// hook: look something up in a tenant-scoped table and stuff it into the JWT.
// Keeping the hook inline (no separate file) so the test stays self-contained
// and a reader can see in one glance what's being asserted.
function makeProfileFeature(data: {
  getSegment: (userId: string, tenantId: TenantId) => string | undefined;
}) {
  return defineFeature("profile", (r) => {
    // A hook returning a feature-scoped claim — `segment` lands under
    // `user.claims["profile:segment"]` after login thanks to the auto-prefix.
    r.authClaims(async (user) => {
      const seg = data.getSegment(user.id, user.tenantId);
      return seg ? { segment: seg } : {};
    });
  });
}

// Second feature — proves two independent hooks can coexist with no collisions
// because the prefix is the feature name.
function makeBillingFeature(plans: Map<TenantId, string>) {
  return defineFeature("billing", (r) => {
    r.authClaims(async (user) => {
      const plan = plans.get(user.tenantId);
      return plan ? { plan } : {};
    });
  });
}

let stack: TestStack;
const systemAdmin = TestUsers.systemAdmin;
const encryptionKey = randomBytes(32).toString("base64");
const tenantA = testTenantId(1);
const tenantB = testTenantId(2);

// Segment data keyed by (userId, tenantId) so different tenants return
// different claim values for the SAME user — this is what we assert in the
// switch-tenant test.
const segmentsByUserAndTenant = new Map<string, string>();
const plansByTenant = new Map<TenantId, string>();

beforeAll(async () => {
  const encryption = createEncryptionProvider(encryptionKey);
  const resolver = createConfigResolver({ encryption });

  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createUserFeature(),
      createTenantFeature(),
      createAuthEmailPasswordFeature(),
      makeProfileFeature({
        getSegment: (userId, tenantId) => segmentsByUserAndTenant.get(`${userId}|${tenantId}`),
      }),
      makeBillingFeature(plansByTenant),
    ],
    extraContext: { configResolver: resolver, configEncryption: encryption },
    authConfig: {
      membershipQuery: "tenant:query:memberships",
      loginHandler: AuthHandlers.login,
      loginErrorStatusMap: {
        [AuthErrors.invalidCredentials]: 401,
        [AuthErrors.noMembership]: 403,
      },
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
  segmentsByUserAndTenant.clear();
  plansByTenant.clear();
});

async function seedUser(email: string, password: string): Promise<string> {
  const hash = await hashPassword(password);
  const created = await stack.http.writeOk<{ id: string }>(
    UserHandlers.create,
    { email, passwordHash: hash, displayName: email.split("@")[0] ?? "user" },
    systemAdmin,
  );
  return created.id;
}

async function addMembership(userId: string, tenantId: TenantId, roles: string[]): Promise<void> {
  await seedRow(stack.db, tenantMembershipsTable, {
    userId,
    tenantId,
    roles: JSON.stringify(roles),
  });
}

describe("scenario 1: login populates claims via r.authClaims hooks", () => {
  test("two features each contribute their prefixed claim into the JWT", async () => {
    const userId = await seedUser("joe@example.com", "pw-long-enough");
    await addMembership(userId, tenantA, ["User"]);

    // Feature data set-up: profile knows this user's segment in tenantA;
    // billing knows this tenant's plan.
    segmentsByUserAndTenant.set(`${userId}|${tenantA}`, "premium");
    plansByTenant.set(tenantA, "pro");

    const res = await stack.http.raw("POST", "/api/auth/login", {
      email: "joe@example.com",
      password: "pw-long-enough",
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.isSuccess).toBe(true);

    // Verify the JWT actually carries the claims — decode via the test stack's jwt helper.
    const payload = await stack.jwt.verify(body.token);
    expect(payload.claims).toEqual({
      "profile:segment": "premium",
      "billing:plan": "pro",
    });
  });

  test("no feature returns data → token has no claims field (not an empty object)", async () => {
    const userId = await seedUser("nomatch@example.com", "pw-long-enough");
    await addMembership(userId, tenantA, ["User"]);
    // Both feature data maps are empty (cleared in beforeEach) so each hook
    // returns {} — and the merged record is also {}.

    const res = await stack.http.raw("POST", "/api/auth/login", {
      email: "nomatch@example.com",
      password: "pw-long-enough",
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    const payload = await stack.jwt.verify(body.token);
    // Absent is explicit — the JWT layer only adds `claims` when there's at
    // least one key, so the client never sees `claims: {}` dead weight.
    expect(payload.claims).toBeUndefined();
  });
});

describe("scenario 2: switch-tenant recomputes claims (no stale tenant-A claims in tenant-B token)", () => {
  test("switching to tenant B wipes tenant-A claims and reads tenant-B data", async () => {
    const userId = await seedUser("multi@example.com", "pw-long-enough");
    await addMembership(userId, tenantA, ["User"]);
    await addMembership(userId, tenantB, ["Admin"]);

    // Tenant-scoped state: user has a "premium" segment in A, "starter" in B.
    // Billing has "pro" plan in A, "free" in B. If switch-tenant merely
    // re-signed the old claims instead of recomputing, we'd see A's claims
    // leak into B's token — a real identity-leak bug.
    segmentsByUserAndTenant.set(`${userId}|${tenantA}`, "premium");
    segmentsByUserAndTenant.set(`${userId}|${tenantB}`, "starter");
    plansByTenant.set(tenantA, "pro");
    plansByTenant.set(tenantB, "free");

    // Login lands in tenantA (first membership by default).
    const loginRes = await stack.http.raw("POST", "/api/auth/login", {
      email: "multi@example.com",
      password: "pw-long-enough",
    });
    const loginBody = await loginRes.json();
    const tokenA = loginBody.token as string;
    const payloadA = await stack.jwt.verify(tokenA);
    expect(payloadA.tenantId).toBe(tenantA);
    expect(payloadA.claims).toEqual({
      "profile:segment": "premium",
      "billing:plan": "pro",
    });

    // Switch to tenantB.
    const switchRes = await stack.http.raw(
      "POST",
      "/api/auth/switch-tenant",
      { tenantId: tenantB },
      { Authorization: `Bearer ${tokenA}` },
    );
    expect(switchRes.status).toBe(200);
    const switchBody = await switchRes.json();
    const tokenB = switchBody.token as string;

    const payloadB = await stack.jwt.verify(tokenB);
    expect(payloadB.tenantId).toBe(tenantB);
    expect(payloadB.roles).toEqual(["Admin"]);

    // The hard part: claims are recomputed from tenant B data, not carried
    // forward from tenant A. "premium"/"pro" MUST NOT appear.
    expect(payloadB.claims).toEqual({
      "profile:segment": "starter",
      "billing:plan": "free",
    });
  });

  test("switching to a tenant with no matching claim data → claims field absent on the new JWT", async () => {
    const userId = await seedUser("sparse@example.com", "pw-long-enough");
    await addMembership(userId, tenantA, ["User"]);
    await addMembership(userId, tenantB, ["Admin"]);

    // Only tenant A has data.
    segmentsByUserAndTenant.set(`${userId}|${tenantA}`, "premium");
    plansByTenant.set(tenantA, "pro");

    const loginRes = await stack.http.raw("POST", "/api/auth/login", {
      email: "sparse@example.com",
      password: "pw-long-enough",
    });
    const tokenA = (await loginRes.json()).token as string;
    const payloadA = await stack.jwt.verify(tokenA);
    expect(payloadA.claims).toEqual({
      "profile:segment": "premium",
      "billing:plan": "pro",
    });

    const switchRes = await stack.http.raw(
      "POST",
      "/api/auth/switch-tenant",
      { tenantId: tenantB },
      { Authorization: `Bearer ${tokenA}` },
    );
    const tokenB = (await switchRes.json()).token as string;
    const payloadB = await stack.jwt.verify(tokenB);

    // Both hooks return {} under tenant B → no claims field on the JWT.
    expect(payloadB.claims).toBeUndefined();
  });
});

describe("scenario 2.5: reserved separator + multi-feature isolation", () => {
  test("one feature returns key with ':' → only that key dropped, other features merge cleanly", async () => {
    const localEncryption = createEncryptionProvider(encryptionKey);
    const localResolver = createConfigResolver({ encryption: localEncryption });
    // A polluted feature that tries to smuggle in a qualified-name-shaped
    // inner key (injecting ":" would otherwise let it spoof another
    // feature's prefix). Plus a clean companion to prove the drop is
    // per-key, not per-feature.
    const polluter = defineFeature("polluter", (r) => {
      r.authClaims(async () => ({
        "other:teamId": "injected", // must be dropped
        legitKey: "ok", // must survive
      }));
    });
    const clean = defineFeature("cleanliness", (r) => {
      r.authClaims(async () => ({ mood: "tidy" }));
    });

    const localStack = await setupTestStack({
      features: [
        createConfigFeature(),
        createUserFeature(),
        createTenantFeature(),
        createAuthEmailPasswordFeature(),
        polluter,
        clean,
      ],
      extraContext: { configResolver: localResolver },
      authConfig: {
        membershipQuery: "tenant:query:memberships",
        loginHandler: AuthHandlers.login,
        loginErrorStatusMap: {
          [AuthErrors.invalidCredentials]: 401,
          [AuthErrors.noMembership]: 403,
        },
      },
    });
    try {
      await unsafeCreateEntityTable(localStack.db, userEntity);
      await unsafeCreateEntityTable(localStack.db, tenantEntity);
      await unsafePushTables(localStack.db, { configValuesTable, tenantMembershipsTable });

      const hash = await hashPassword("pw-long-enough");
      const created = await localStack.http.writeOk<{ id: string }>(
        UserHandlers.create,
        { email: "sep@example.com", passwordHash: hash, displayName: "Sep" },
        systemAdmin,
      );
      await seedTenantMembership(localStack.db, {
        userId: created.id,
        tenantId: tenantA,
        roles: ["User"],
      });

      const res = await localStack.http.raw("POST", "/api/auth/login", {
        email: "sep@example.com",
        password: "pw-long-enough",
      });
      expect(res.status).toBe(200);
      const { token } = (await res.json()) as { token: string };
      const payload = await localStack.jwt.verify(token);

      // The colon-laden key is gone. The polluter's other key + the clean
      // feature's key both made it through under their own prefixes.
      expect(payload.claims).toEqual({
        "polluter:legitKey": "ok",
        "cleanliness:mood": "tidy",
      });
      // And critically: no "other:teamId" survived — the polluter cannot
      // spoof another feature's namespace by embedding the separator.
      expect(payload.claims).not.toHaveProperty("other:teamId");
    } finally {
      await localStack.cleanup();
    }
  });
});

describe("scenario 2.6: multi-feature drift warnings fire independently", () => {
  test("feature A + feature B both return undeclared keys → each logs its own warning", async () => {
    const localEncryption = createEncryptionProvider(encryptionKey);
    const localResolver = createConfigResolver({ encryption: localEncryption });

    // Capture warn() calls to verify drift warnings fire per-feature, not
    // globally collapsed.
    const warnCalls: Array<{ msg: string; data?: Record<string, unknown> }> = [];
    const testLogger = {
      info: () => {},
      warn: (msg: string, data?: Record<string, unknown>) => {
        warnCalls.push({ msg, ...(data && { data }) });
      },
      error: () => {},
      debug: () => {},
      child() {
        return this;
      },
    };

    // Feature A declares `teamId` but returns both `teamId` AND undeclared
    // `stray`. Feature B declares `plan` but returns both `plan` AND
    // undeclared `extra`. Both should fire drift warnings — distinct feature
    // names, distinct keys.
    const featA = defineFeature("alpha", (r) => {
      r.claimKey("teamId", { type: "string" });
      r.authClaims(async () => ({ teamId: "t1", stray: "drift-a" }));
    });
    const featB = defineFeature("beta", (r) => {
      r.claimKey("plan", { type: "string" });
      r.authClaims(async () => ({ plan: "pro", extra: "drift-b" }));
    });

    const localStack = await setupTestStack({
      features: [
        createConfigFeature(),
        createUserFeature(),
        createTenantFeature(),
        createAuthEmailPasswordFeature(),
        featA,
        featB,
      ],
      extraContext: { configResolver: localResolver, log: testLogger },
      authConfig: {
        membershipQuery: "tenant:query:memberships",
        loginHandler: AuthHandlers.login,
        loginErrorStatusMap: {
          [AuthErrors.invalidCredentials]: 401,
          [AuthErrors.noMembership]: 403,
        },
      },
    });
    try {
      await unsafeCreateEntityTable(localStack.db, userEntity);
      await unsafeCreateEntityTable(localStack.db, tenantEntity);
      await unsafePushTables(localStack.db, { configValuesTable, tenantMembershipsTable });

      const hash = await hashPassword("pw-long-enough");
      const created = await localStack.http.writeOk<{ id: string }>(
        UserHandlers.create,
        { email: "drift@example.com", passwordHash: hash, displayName: "Drift" },
        systemAdmin,
      );
      await seedTenantMembership(localStack.db, {
        userId: created.id,
        tenantId: tenantA,
        roles: ["User"],
      });

      const res = await localStack.http.raw("POST", "/api/auth/login", {
        email: "drift@example.com",
        password: "pw-long-enough",
      });
      expect(res.status).toBe(200);

      // Two distinct drift warnings — per-feature, per-key, not collapsed.
      const drifts = warnCalls.filter((w) => w.msg.includes("not declared via r.claimKey()"));
      expect(drifts).toHaveLength(2);
      const features = drifts.map((w) => w.data?.["featureName"]).sort();
      expect(features).toEqual(["alpha", "beta"]);
      const keys = drifts.map((w) => w.data?.["undeclaredKey"]).sort();
      expect(keys).toEqual(["extra", "stray"]);
    } finally {
      await localStack.cleanup();
    }
  });
});

describe("scenario 3: a broken claims hook does not break login", () => {
  test("hook throws → login still succeeds, broken feature simply contributes nothing, warn logged with featureName+err", async () => {
    const localEncryption = createEncryptionProvider(encryptionKey);
    const localResolver = createConfigResolver({ encryption: localEncryption });

    // Capture warn-calls so the test can verify the resolver actually
    // logged the broken hook with featureName + err.message — previously
    // the test only asserted "login still succeeded", which would pass
    // even if the log statement silently disappeared.
    const warnCalls: Array<{ msg: string; data?: Record<string, unknown> }> = [];
    const testLogger = {
      info: () => {},
      warn: (msg: string, data?: Record<string, unknown>) => {
        warnCalls.push({ msg, ...(data && { data }) });
      },
      error: () => {},
      debug: () => {},
      child() {
        return this;
      },
    };

    const brokenFeature = defineFeature("broken", (r) => {
      r.authClaims(async () => {
        throw new Error("pretend the DB exploded");
      });
    });
    const healthyFeature = defineFeature("drivers", (r) => {
      r.authClaims(async () => ({ teamId: "t-42" }));
    });

    const localStack = await setupTestStack({
      features: [
        createConfigFeature(),
        createUserFeature(),
        createTenantFeature(),
        createAuthEmailPasswordFeature(),
        brokenFeature,
        healthyFeature,
      ],
      extraContext: { configResolver: localResolver, log: testLogger },
      authConfig: {
        membershipQuery: "tenant:query:memberships",
        loginHandler: AuthHandlers.login,
        loginErrorStatusMap: {
          [AuthErrors.invalidCredentials]: 401,
          [AuthErrors.noMembership]: 403,
        },
      },
    });
    try {
      await unsafeCreateEntityTable(localStack.db, userEntity);
      await unsafeCreateEntityTable(localStack.db, tenantEntity);
      await unsafePushTables(localStack.db, { configValuesTable, tenantMembershipsTable });

      const hash = await hashPassword("pw-long-enough");
      const created = await localStack.http.writeOk<{ id: string }>(
        UserHandlers.create,
        { email: "broken@example.com", passwordHash: hash, displayName: "Broken" },
        systemAdmin,
      );
      await seedTenantMembership(localStack.db, {
        userId: created.id,
        tenantId: tenantA,
        roles: ["User"],
      });

      const res = await localStack.http.raw("POST", "/api/auth/login", {
        email: "broken@example.com",
        password: "pw-long-enough",
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.isSuccess).toBe(true);

      const payload = await localStack.jwt.verify(body.token);
      expect(payload.claims).toEqual({ "drivers:teamId": "t-42" });

      // The resolver MUST have logged the failure with feature name and
      // error message — ops needs that breadcrumb to find the bug.
      const threwLog = warnCalls.find((w) => w.msg.includes("hook threw"));
      expect(threwLog).toBeDefined();
      expect(threwLog?.data?.["featureName"]).toBe("broken");
      expect(threwLog?.data?.["err"]).toBe("pretend the DB exploded");
    } finally {
      await localStack.cleanup();
    }
  });
});
