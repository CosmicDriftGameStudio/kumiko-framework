// Session Revocation Sample — Integration Test
//
// Drives the wiring from the sample's comment snippet end-to-end against
// real HTTP + DB + Redis. If a reader copies the buildServer({...}) block
// verbatim, the resulting app behaves like this test asserts.

import {
  AuthHandlers,
  createAuthEmailPasswordFeature,
  hashPassword,
} from "@kumiko/bundled-features/auth-email-password";
import { configValuesTable, createConfigFeature } from "@kumiko/bundled-features/config";
import {
  type SessionCallbacks,
  userSessionEntity,
  userSessionTable,
} from "@kumiko/bundled-features/sessions";
import { sessionCallbacksFromLateBound } from "@kumiko/bundled-features/sessions/testing";
import {
  createTenantFeature,
  tenantEntity,
  tenantMembershipsTable,
} from "@kumiko/bundled-features/tenant";
import { seedTenantMembership } from "@kumiko/bundled-features/tenant/seeding";
import {
  createUserFeature,
  UserHandlers,
  userEntity,
  userTable,
} from "@kumiko/bundled-features/user";
import type { TenantId } from "@kumiko/framework/engine";
import {
  createEntityTable,
  createLateBoundHolder,
  pushTables,
  setupTestStack,
  type TestStack,
  TestUsers,
  testTenantId,
} from "@kumiko/framework/testing";
import * as jose from "jose";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { createSessionCallbacks, createSessionsFeature } from "../feature";

const TENANT: TenantId = testTenantId(1);

let stack: TestStack;
const callbacks = createLateBoundHolder<SessionCallbacks>("session-callbacks");

beforeAll(async () => {
  const bound = sessionCallbacksFromLateBound(callbacks);
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createUserFeature(),
      createTenantFeature(),
      createAuthEmailPasswordFeature(),
      createSessionsFeature(),
    ],
    authConfig: {
      ...bound.asAuthConfig(),
      membershipQuery: "tenant:query:memberships",
      loginHandler: AuthHandlers.login,
    },
  });
  callbacks.set(createSessionCallbacks({ db: stack.db }));

  await createEntityTable(stack.db, userEntity);
  await createEntityTable(stack.db, userSessionEntity);
  await createEntityTable(stack.db, tenantEntity);
  await pushTables(stack.db, { configValuesTable, tenantMembershipsTable });
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await stack.db.delete(userSessionTable);
  await stack.db.delete(userTable);
  await stack.db.delete(tenantMembershipsTable);
});

describe("session-revocation sample wiring", () => {
  test("end-to-end: login, use, logout, reject", async () => {
    const hash = await hashPassword("super-long-password");
    const created = await stack.http.writeOk<{ id: string }>(
      UserHandlers.create,
      { email: "demo@example.com", passwordHash: hash, displayName: "Demo" },
      TestUsers.systemAdmin,
    );
    await seedTenantMembership(stack.db, {
      userId: created.id,
      tenantId: TENANT,
      roles: ["User"],
    });

    const loginRes = await stack.http.raw("POST", "/api/auth/login", {
      email: "demo@example.com",
      password: "super-long-password",
    });
    expect(loginRes.status).toBe(200);
    const { token } = (await loginRes.json()) as { token: string };
    expect(jose.decodeJwt(token).jti).toBeTypeOf("string");

    const beforeLogout = await stack.http.raw(
      "POST",
      "/api/query",
      { type: "user:query:user:me", payload: {} },
      { Authorization: `Bearer ${token}` },
    );
    expect(beforeLogout.status).toBe(200);

    const logout = await stack.http.raw("POST", "/api/auth/logout", undefined, {
      Authorization: `Bearer ${token}`,
    });
    expect(logout.status).toBe(200);

    const afterLogout = await stack.http.raw(
      "POST",
      "/api/query",
      { type: "user:query:user:me", payload: {} },
      { Authorization: `Bearer ${token}` },
    );
    expect(afterLogout.status).toBe(401);
  });
});
