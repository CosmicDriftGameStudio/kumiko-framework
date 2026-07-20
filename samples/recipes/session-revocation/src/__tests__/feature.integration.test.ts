// Session Revocation Sample — Integration Test
//
// Drives the wiring from the sample's comment snippet end-to-end against
// real HTTP + DB + Redis. If a reader copies the buildServer({...}) block
// verbatim, the resulting app behaves like this test asserts.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  AuthHandlers,
  createAuthEmailPasswordFeature,
  hashPassword,
} from "@cosmicdrift/kumiko-bundled-features/auth-email-password";
import {
  configValuesTable,
  createConfigFeature,
} from "@cosmicdrift/kumiko-bundled-features/config";
import {
  type SessionCallbacks,
  userSessionEntity,
  userSessionTable,
} from "@cosmicdrift/kumiko-bundled-features/sessions";
import {
  sessionCallbacksFromLateBound,
  withMintedSession,
} from "@cosmicdrift/kumiko-bundled-features/sessions/testing";
import {
  createTenantFeature,
  tenantEntity,
  tenantMembershipsTable,
} from "@cosmicdrift/kumiko-bundled-features/tenant";
import { seedTenantMembership } from "@cosmicdrift/kumiko-bundled-features/tenant/seeding";
import {
  createUserFeature,
  UserHandlers,
  userEntity,
  userTable,
} from "@cosmicdrift/kumiko-bundled-features/user";
import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import {
  setupTestStack,
  type TestStack,
  TestUsers,
  testTenantId,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import { createLateBoundHolder } from "@cosmicdrift/kumiko-framework/testing";
import * as jose from "jose";
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

  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafeCreateEntityTable(stack.db, userSessionEntity);
  await unsafeCreateEntityTable(stack.db, tenantEntity);
  await unsafePushTables(stack.db, { configValuesTable, tenantMembershipsTable });
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await asRawClient(stack.db).unsafe(`DELETE FROM "${userSessionTable.tableName}"`);
  await asRawClient(stack.db).unsafe(`DELETE FROM "${userTable.tableName}"`);
  await asRawClient(stack.db).unsafe(`DELETE FROM "${tenantMembershipsTable.tableName}"`);
});

describe("session-revocation sample wiring", () => {
  test("end-to-end: login, use, logout, reject", async () => {
    const hash = await hashPassword("super-long-password");
    const actor = await withMintedSession(
      (user, meta) => callbacks.get().sessionCreator(user, meta),
      TestUsers.systemAdmin,
    );
    const created = await stack.http.writeOk<{ id: string }>(
      UserHandlers.create,
      { email: "demo@example.com", passwordHash: hash, displayName: "Demo" },
      actor,
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
