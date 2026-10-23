import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import type { TestStack } from "@cosmicdrift/kumiko-testing/stack";
import { SessionQueries } from "../constants.ts";
import {
  type SessionsTestCallbacks,
  type SessionsTestStack,
  setupSessionsTestStack,
} from "./sessions-test-stack.ts";
import { makeSessionHelpers } from "./test-helpers.ts";

let stack: TestStack;
let h: ReturnType<typeof makeSessionHelpers>;
let callbacks: SessionsTestCallbacks;
let resetBetweenTests: SessionsTestStack["resetBetweenTests"];

beforeAll(async () => {
  ({ stack, h, callbacks, resetBetweenTests } = await setupSessionsTestStack());
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await resetBetweenTests();
});

describe("sessions feature — admin detail and tenant isolation", () => {
  // Single-row inspector backing the session-detail screen.
  // Same access-gate as session:list (admin-or-higher); verifies field-shape,
  // decryption of ip/userAgent, and the "unknown id" not-found path.
  test("session:detail returns one decrypted row for admins, null for an unknown id", async () => {
    const { userId: aliceId } = await h.seedUser("alice3@example.com", "pw-long-enough", {
      roles: ["Admin"],
    });

    const aliceAsAdmin = await h.login("alice3@example.com", "pw-long-enough");

    const res = await h.authedPost("/api/query", aliceAsAdmin.token, {
      type: SessionQueries.detail,
      payload: { id: aliceAsAdmin.sid },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { id: string; userId: string; revokedAt: string | null } | null;
    };
    expect(body.data?.id).toBe(aliceAsAdmin.sid);
    expect(body.data?.userId).toBe(aliceId);
    expect(body.data?.revokedAt).toBeNull();

    const missing = await h.authedPost("/api/query", aliceAsAdmin.token, {
      type: SessionQueries.detail,
      payload: { id: "00000000-0000-4000-8000-0000deadbeef" },
    });
    expect(missing.status).toBe(200);
    const missingBody = (await missing.json()) as { data: unknown };
    expect(missingBody.data).toBeNull();

    // Plain User gets the same 403 as session:list — same access-gate.
    await h.seedUser("bob3@example.com", "pw-long-enough");
    const bob = await h.login("bob3@example.com", "pw-long-enough");
    const asUser = await h.authedPost("/api/query", bob.token, {
      type: SessionQueries.detail,
      payload: { id: aliceAsAdmin.sid },
    });
    expect(asUser.status).toBe(403);
  });

  // IDOR guard: session:detail/session:list are scoped by ctx.db (TenantDb)
  // alone, no explicit tenant predicate in the handler — an admin from a
  // different tenant must not be able to read another tenant's session rows.
  test("session:detail and session:list never leak sessions across tenants", async () => {
    const TENANT_2 = testTenantId(2);
    const h2 = makeSessionHelpers(stack, TENANT_2, (user, meta) =>
      callbacks.get().sessionCreator(user, meta),
    );

    await h.seedUser("carol4@example.com", "pw-long-enough", {
      roles: ["Admin"],
    });
    const carolAsAdmin = await h.login("carol4@example.com", "pw-long-enough");

    await h2.seedUser("dave4@example.com", "pw-long-enough", {
      roles: ["Admin"],
    });
    const daveAsAdmin = await h2.login("dave4@example.com", "pw-long-enough");

    const detailRes = await h2.authedPost("/api/query", daveAsAdmin.token, {
      type: SessionQueries.detail,
      payload: { id: carolAsAdmin.sid },
    });
    expect(detailRes.status).toBe(200);
    const detailBody = (await detailRes.json()) as { data: unknown };
    expect(detailBody.data).toBeNull();

    const listRes = await h2.authedPost("/api/query", daveAsAdmin.token, {
      type: SessionQueries.list,
      payload: {},
    });
    expect(listRes.status).toBe(200);
    const listBody = (await listRes.json()) as { data: { rows: Array<{ id: string }> } };
    expect(listBody.data.rows.map((r) => r.id)).not.toContain(carolAsAdmin.sid);
  });
});
