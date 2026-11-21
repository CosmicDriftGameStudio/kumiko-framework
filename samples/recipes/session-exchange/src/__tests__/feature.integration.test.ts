// Session Exchange Sample — Integration Test
//
// Real HTTP + DB: an app-defined exchange handler is listed under
// auth.sessionExchangeHandlers and the framework route mints the session.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  AuthErrors,
  hashPassword,
  sessionForVerifiedUser,
} from "@cosmicdrift/kumiko-bundled-features/auth-email-password";
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
import {
  softDeleteUserViaEventStore,
  updateUserViaEventStore,
} from "@cosmicdrift/kumiko-bundled-features/user/testing";
import { defineFeature, type TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { TestUsers, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import {
  setupTestStack,
  type TestStack,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import { z } from "zod";
import {
  DEMO_EXCHANGE_CODE,
  DEMO_EXCHANGE_QN,
  demoExchangeFeature,
  INVALID_CREDENTIALS_REASON,
} from "../feature";

// An app that linked the identity itself (e.g. a provider subject id) exchanges by userId.
const LINKED_EXCHANGE_QN = "linked-exchange:write:exchange";
const linkedExchangeFeature = defineFeature("linked-exchange", (r) => {
  r.requires({ features: ["user", "tenant"] });

  r.writeHandler({
    name: "exchange",
    schema: z.object({ userId: z.string() }),
    access: { roles: ["anonymous"] },
    escapeHatch: {
      grants: ["systemIdentity"],
      reason:
        "Unauthenticated exchange has no caller identity yet — sessionForVerifiedUser looks up the user and resolves the membership as SYSTEM before a session exists.",
    },
    agent: { expose: false },
    handler: async (event, ctx) => sessionForVerifiedUser(ctx, { userId: event.payload.userId }),
  });
});

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
      linkedExchangeFeature,
    ],
    authConfig: {
      membershipQuery: "tenant:query:memberships",
      sessionExchangeHandlers: { code: DEMO_EXCHANGE_QN, linked: LINKED_EXCHANGE_QN },
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
    expect(res.status).toBe(422);
    expect(res.headers.getSetCookie()).toEqual([]);
    const body = await res.json();
    expect(JSON.stringify(body)).toContain(AuthErrors.accountRestricted);
    expect((body as { token?: string }).token).toBeUndefined();
  });

  describe("lookup by userId (identity linked by the app)", () => {
    function exchangeLinked(userId: string): Promise<Response> {
      return exchange({ method: "linked", payload: { userId } });
    }

    test("skips the email-verified gate: an unverified user gets a working token", async () => {
      const userId = await createMember("linked-unverified@example.com", { verified: false });
      const res = await exchangeLinked(userId);
      expect(res.status).toBe(200);
      const { token } = (await res.json()) as { token: string };
      const me = await stack.http.raw(
        "POST",
        "/api/query",
        { type: "user:query:user:me", payload: {} },
        { Authorization: `Bearer ${token}` },
      );
      expect(me.status).toBe(200);
    });

    test("a deleted user is invalid_credentials", async () => {
      const userId = await createMember("linked-deleted@example.com", { verified: true });
      await softDeleteUserViaEventStore(stack.db, userId);
      const res = await exchangeLinked(userId);
      expect(res.status).toBe(401);
      expect(res.headers.getSetCookie()).toEqual([]);
    });

    test("a non-uuid userId is invalid_credentials, not a server error", async () => {
      const res = await exchangeLinked("not-a-uuid");
      expect(res.status).toBe(401);
      expect(res.headers.getSetCookie()).toEqual([]);
    });
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
