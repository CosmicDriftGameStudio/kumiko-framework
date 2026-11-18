// Session Exchange Sample — Integration Test
//
// Real HTTP + DB: an app-defined exchange handler is listed under
// auth.sessionExchangeHandlers and the framework route mints the session.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { AuthErrors, hashPassword } from "@cosmicdrift/kumiko-bundled-features/auth-email-password";
import {
  configValuesTable,
  createConfigFeature,
} from "@cosmicdrift/kumiko-bundled-features/config";
import {
  createTenantFeature,
  tenantMembershipsTable,
} from "@cosmicdrift/kumiko-bundled-features/tenant";
import { seedTenantMembership } from "@cosmicdrift/kumiko-bundled-features/tenant/seeding";
import {
  createUserFeature,
  USER_STATUS,
  UserHandlers,
} from "@cosmicdrift/kumiko-bundled-features/user";
import { updateUserViaEventStore } from "@cosmicdrift/kumiko-bundled-features/user/testing";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { TestUsers, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import {
  setupTestStack,
  type TestStack,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import {
  DEMO_EXCHANGE_CODE,
  DEMO_EXCHANGE_QN,
  demoExchangeFeature,
  INVALID_CREDENTIALS_REASON,
} from "../feature";

const TENANT: TenantId = testTenantId(1);
const EMAIL = "exchange@example.com";

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createUserFeature(),
      createTenantFeature(),
      demoExchangeFeature,
    ],
    authConfig: {
      membershipQuery: "tenant:query:memberships",
      sessionExchangeHandlers: { code: DEMO_EXCHANGE_QN },
      loginErrorStatusMap: { [INVALID_CREDENTIALS_REASON]: 401 },
      loginRateLimit: null,
    },
  });

  await unsafePushTables(stack.db, { configValuesTable, tenantMembershipsTable });

  await createMember(EMAIL, { verified: true });
});

async function createMember(email: string, opts: { verified: boolean }): Promise<string> {
  const created = await stack.http.writeOk<{ id: string }>(
    UserHandlers.create,
    {
      email,
      passwordHash: await hashPassword("super-long-password"),
      displayName: "Exchange",
    },
    TestUsers.systemAdmin,
  );
  await seedTenantMembership(stack.db, { userId: created.id, tenantId: TENANT, roles: ["User"] });
  if (opts.verified) {
    await updateUserViaEventStore(stack.db, created.id, { emailVerified: true });
  }
  return created.id;
}

afterAll(async () => {
  await stack.cleanup();
});

function exchange(body: unknown): Promise<Response> {
  return stack.http.raw("POST", "/api/auth/session-exchange", body);
}

describe("session-exchange sample wiring", () => {
  test("valid code mints a token that authenticates a query", async () => {
    const res = await exchange({
      method: "code",
      payload: { email: EMAIL, code: DEMO_EXCHANGE_CODE },
    });
    expect(res.status).toBe(200);
    const { token } = (await res.json()) as { token: string };
    expect(token.length).toBeGreaterThan(20);

    const me = await stack.http.raw(
      "POST",
      "/api/query",
      { type: "user:query:user:me", payload: {} },
      { Authorization: `Bearer ${token}` },
    );
    expect(me.status).toBe(200);
  });

  test("wrong code is 401 via invalid_credentials", async () => {
    const res = await exchange({ method: "code", payload: { email: EMAIL, code: "000000" } });
    expect(res.status).toBe(401);
  });

  test("a restricted user gets no session", async () => {
    const restrictedId = await createMember("restricted@example.com", { verified: true });
    await updateUserViaEventStore(stack.db, restrictedId, { status: USER_STATUS.Restricted });

    const res = await exchange({
      method: "code",
      payload: { email: "restricted@example.com", code: DEMO_EXCHANGE_CODE },
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.headers.getSetCookie()).toEqual([]);
    expect(((await res.json()) as { token?: string }).token).toBeUndefined();
  });

  test("an unverified email gets no session", async () => {
    await createMember("unverified@example.com", { verified: false });
    const res = await exchange({
      method: "code",
      payload: { email: "unverified@example.com", code: DEMO_EXCHANGE_CODE },
    });
    expect(res.status).toBe(422);
    expect(res.headers.getSetCookie()).toEqual([]);
    expect(JSON.stringify(await res.json())).toContain(AuthErrors.emailNotVerified);
  });

  test("unknown method is 400", async () => {
    const res = await exchange({ method: "other", payload: {} });
    expect(res.status).toBe(400);
  });
});
