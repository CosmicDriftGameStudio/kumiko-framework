// GET /api/auth/tenants is exempt from the L2 auth-endpoint rate limit;
// credential endpoints on the same /api/auth/* mount (e.g. login) keep the default limit.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import type { SessionUser } from "@cosmicdrift/kumiko-framework/engine";
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
import { createTenantFeature } from "../../tenant";
import { tenantMembershipsTable } from "../../tenant/membership-table";
import { tenantEntity } from "../../tenant/schema/tenant";
import { seedTenantMembership } from "../../tenant/testing";
import { UserHandlers } from "../../user";
import { createUserFeature } from "../../user/feature";
import { userEntity } from "../../user/schema/user";
import { AuthHandlers } from "../constants";
import { createAuthEmailPasswordFeature } from "../feature";

let stack: TestStack;
const encryptionKey = randomBytes(32).toString("base64");
const membershipTenantId = "00000000-0000-4000-8000-000000000001";

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
    },
    // No `limit` override — this proves the real framework default (5/60s)
    // exempts GET /api/auth/tenants and still throttles POST /api/auth/login.
    rateLimit: {
      auth: { onFailClosed: () => {} },
    },
  });

  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafeCreateEntityTable(stack.db, tenantEntity);
  await unsafePushTables(stack.db, { configValuesTable, tenantMembershipsTable });
});

afterAll(async () => {
  await stack.cleanup();
});

async function getTenants(token: string, ip: string): Promise<Response> {
  return stack.app.request("/api/auth/tenants", {
    method: "GET",
    headers: { Authorization: `Bearer ${token}`, "x-forwarded-for": ip },
  });
}

async function postLogin(ip: string, email: string): Promise<Response> {
  return stack.app.request("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify({ email, password: "wrong-password" }),
  });
}

describe("GET /api/auth/tenants is exempt from the L2 auth rate limit", () => {
  test("10 GETs from the same IP all succeed — the 6th would 429 without the exemption", async () => {
    const created = await stack.http.writeOk<{ id: string }>(
      UserHandlers.create,
      { email: "tenants-exempt@example.com", passwordHash: "unused", displayName: "exempt-user" },
      TestUsers.systemAdmin,
    );
    await seedTenantMembership(stack.db, {
      userId: created.id,
      tenantId: membershipTenantId,
      roles: ["User"],
    });
    const user: SessionUser = { id: created.id, tenantId: membershipTenantId, roles: ["User"] };
    const token = await stack.jwt.sign(user);
    const ip = "10.70.0.1";

    for (let i = 0; i < 10; i++) {
      const res = await getTenants(token, ip);
      expect(res.status).toBe(200);
    }
    const body = await (await getTenants(token, ip)).json();
    expect(body.tenants.length).toBe(1);
  });
});

describe("POST /api/auth/login keeps the default L2 limit (5/60s)", () => {
  test("6th login attempt from the same IP is 429 via the L2 bucket, not just the route's own limiter", async () => {
    const ip = "10.70.0.2";
    for (let i = 0; i < 5; i++) {
      await postLogin(ip, `nope-${i}@example.com`);
    }
    const blocked = await postLogin(ip, "nope-5@example.com");
    expect(blocked.status).toBe(429);
    const body = (await blocked.json()) as { error: { code: string; details: { bucket: string } } };
    expect(body.error.code).toBe("rate_limited");
    expect(body.error.details.bucket).toBe(`l2:${ip}:/api/auth/login`);
  });
});
