// Tests the `sessionStrictMode` flag on AuthRoutesConfig. When enabled, a
// JWT that arrives WITHOUT a `jti` is rejected at the middleware — useful
// after a rolling deploy has been emitting sids longer than the JWT TTL,
// so legacy stateless tokens are expected to have expired. Default false
// keeps pre-upgrade tokens working; this suite flips it on and asserts.

import type { TenantId } from "@kumiko/framework/engine";
import { setupTestStack, type TestStack, TestUsers, testTenantId } from "@kumiko/framework/stack";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createConfigFeature } from "../../config";
import { createTenantFeature } from "../../tenant";
import { createUserFeature } from "../../user";
import { createAuthEmailPasswordFeature } from "../feature";

let stack: TestStack;
const TENANT: TenantId = testTenantId(1);
const userId = TestUsers.systemAdmin.id;

// Stub checker that always accepts. The strictMode branch runs BEFORE the
// checker is even consulted (no jti → nothing to check), so the stub never
// fires in the strict-mode path. It's present to satisfy the framework's
// "you wired sessionChecker, so we'll run it if we have an sid" contract.
// Accepts the full AuthSessionChecker signature (sid + expectedUserId)
// even though it doesn't use the args.
async function stubChecker(_sid: string, _expectedUserId: string): Promise<"live"> {
  return "live";
}

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createUserFeature(),
      createTenantFeature(),
      createAuthEmailPasswordFeature(),
    ],
    authConfig: {
      membershipQuery: "tenant:query:memberships",
      sessionChecker: stubChecker,
      sessionStrictMode: true,
    },
  });
});

afterAll(async () => {
  await stack.cleanup();
});

describe("sessionStrictMode: sidless JWTs are rejected", () => {
  test("JWT without jti → 401 with reason=no_sid", async () => {
    // Hand-signed JWT that carries id + tenantId + roles but NO jti. The
    // standard testing request-helper signs JWTs the same way on user
    // arguments without a sid field.
    const token = await stack.jwt.sign({ id: userId, tenantId: TENANT, roles: ["SystemAdmin"] });

    const res = await stack.http.raw(
      "POST",
      "/api/query",
      { type: "user:query:user:me", payload: {} },
      { Authorization: `Bearer ${token}` },
    );
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error?: { details?: { reason?: string } } };
    expect(body.error?.details?.reason).toBe("no_sid");
  });

  test("JWT WITH jti passes the middleware gate (stubChecker returns 'live')", async () => {
    const token = await stack.jwt.sign({
      id: userId,
      tenantId: TENANT,
      roles: ["SystemAdmin"],
      sid: "aaaa1111-bbbb-2222-cccc-3333dddd4444",
    });

    // Hit /health — it's in PUBLIC_API_PATHS and bypasses auth entirely,
    // so a success there tells us nothing. Instead send to a known handler
    // and just assert the middleware didn't turn it into a 401. The
    // minimal stack has no user-table; the me-query would 500 on its SQL
    // call, which is fine for this test (we're specifically NOT making
    // statements about the handler behaviour). 401 means "middleware
    // blocked us", which is exactly the bug this suite catches.
    const res = await stack.http.raw(
      "POST",
      "/api/query",
      { type: "user:query:user:me", payload: {} },
      { Authorization: `Bearer ${token}` },
    );
    expect(res.status).not.toBe(401);
    // Narrow the "not 401" to exclude other 4xx middleware errors too.
    // A 403 from access-layer or a 400 from shape-validation wouldn't
    // come from sessionStrictMode, but either would be a different code
    // path than the one we're testing — flag them if they surface.
    expect(res.status).not.toBe(403);
    expect(res.status).not.toBe(400);
  });
});
