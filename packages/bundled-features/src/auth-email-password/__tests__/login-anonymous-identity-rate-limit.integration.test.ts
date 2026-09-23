// login.write.ts's access.roles: ["anonymous"] carries a mandatory
// handler-level rateLimit: { per: "ip+handler", limit: 20, windowSeconds: 60 }
// (boot-validator's validateAnonymousRateLimit). Proves that L3 handler
// rate-limit fires over real HTTP, and that a legitimate login still succeeds.
//
// loginRateLimit is disabled (null): the route's own in-memory limiter
// buckets on "ip|email" and would trip before the handler-level "ip+handler"
// bucket under the same IP — this isolates the handler-level rateLimit.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  setupTestStack,
  type TestStack,
  TestUsers,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import { createTestEnvelopeCipher } from "@cosmicdrift/kumiko-framework/testing";
import { createConfigFeature } from "../../config";
import { createConfigResolver } from "../../config/resolver";
import { configValuesTable } from "../../config/table";
import { hashPassword } from "../../shared";
import { createTenantFeature } from "../../tenant";
import { tenantMembershipsTable } from "../../tenant/membership-table";
import { tenantEntity } from "../../tenant/schema/tenant";
import { seedTenantMembership } from "../../tenant/testing";
import { UserHandlers } from "../../user";
import { createUserFeature } from "../../user/feature";
import { userEntity, userTable } from "../../user/schema/user";
import { AuthErrors, AuthHandlers } from "../constants";
import { createAuthEmailPasswordFeature } from "../feature";

let stack: TestStack;
const encryptionKey = randomBytes(32).toString("base64");

beforeAll(async () => {
  const encryption = createTestEnvelopeCipher(encryptionKey);
  const resolver = createConfigResolver({ cipher: encryption });

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
      loginRateLimit: null,
      loginErrorStatusMap: {
        [AuthErrors.invalidCredentials]: 401,
        [AuthErrors.noMembership]: 403,
      },
    },
  });

  await stack.redis.flushNamespace();
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
  await stack.redis.flushNamespace();
});

const systemAdmin = TestUsers.systemAdmin;

async function seedLoginUser(email: string, password: string): Promise<void> {
  const hash = await hashPassword(password);
  const created = await stack.http.writeOk<{ id: string }>(
    UserHandlers.create,
    { email, passwordHash: hash, displayName: email.split("@")[0] ?? "user" },
    systemAdmin,
  );
  await seedTenantMembership(stack.db, {
    userId: created.id,
    tenantId: "00000000-0000-4000-8000-000000000001",
    roles: ["User"],
  });
}

async function postLogin(ip: string, email: string, password: string): Promise<Response> {
  return await stack.app.request("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify({ email, password }),
  });
}

describe("POST /auth/login — anonymous identity handler rateLimit (ip+handler)", () => {
  test("21st failed login from the same IP is rejected with rate_limited (429)", async () => {
    const ip = "10.60.0.1";
    for (let i = 0; i < 20; i++) {
      const res = await postLogin(ip, `nope-${i}@example.com`, "wrong-password");
      expect(res.status).toBe(401);
    }
    const last = await postLogin(ip, "nope-20@example.com", "wrong-password");
    expect(last.status).toBe(429);
    const body = (await last.json()) as { error?: { code?: string } | string };
    const code = typeof body.error === "string" ? body.error : body.error?.code;
    expect(code).toBe("rate_limited");
  });

  test("a legitimate login still succeeds (anonymous dispatch identity didn't break the happy path)", async () => {
    const ip = "10.60.0.2";
    await seedLoginUser("legit@example.com", "correct horse battery staple");

    const res = await postLogin(ip, "legit@example.com", "correct horse battery staple");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { isSuccess: boolean };
    expect(body.isSuccess).toBe(true);
  });
});
