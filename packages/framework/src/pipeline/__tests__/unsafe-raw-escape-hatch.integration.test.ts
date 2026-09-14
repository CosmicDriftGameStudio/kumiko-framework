// fw#2858 — a write/query handler's `escapeHatch` also gates ctx.db.unsafeRaw(reason):
// WITH it the raw query succeeds, WITHOUT it the same handler rejects with access_denied.
// Real HTTP calls + setupTestStack — never createTestDispatcher. Modelled exactly on
// escape-hatch.integration.test.ts (fw#2855).

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { z } from "zod";
import { executeRawQuery } from "../../db/queries/raw-sql";
import { defineFeature } from "../../engine";
import { createTestUser, setupTestStack, type TestStack } from "../../stack";

const unsafeRawFeature = defineFeature("unsafe-raw-probe", (r) => {
  r.writeHandler({
    name: "write-with-hatch",
    schema: z.object({}),
    access: { roles: ["User"] },
    escapeHatch: { reason: "fw#2858 integration test — declared unsafeRaw write" },
    handler: async (_event, ctx) => {
      const runner = ctx.db.unsafeRaw("fw#2858 integration test — declared unsafeRaw write");
      const rows = await executeRawQuery<{ one: number }>(runner, "SELECT 1 AS one");
      return { isSuccess: true as const, data: { one: rows[0]?.one } };
    },
  });

  r.writeHandler({
    name: "write-without-hatch",
    schema: z.object({}),
    access: { roles: ["User"] },
    handler: async (_event, ctx) => {
      const runner = ctx.db.unsafeRaw("no escapeHatch declared — must throw before this runs");
      const rows = await executeRawQuery<{ one: number }>(runner, "SELECT 1 AS one");
      return { isSuccess: true as const, data: { one: rows[0]?.one } };
    },
  });

  r.queryHandler({
    name: "query-with-hatch",
    schema: z.object({}),
    access: { roles: ["User"] },
    escapeHatch: { reason: "fw#2858 integration test — declared unsafeRaw query" },
    handler: async (_query, ctx) => {
      const runner = ctx.db.unsafeRaw("fw#2858 integration test — declared unsafeRaw query");
      const rows = await executeRawQuery<{ one: number }>(runner, "SELECT 1 AS one");
      return { one: rows[0]?.one };
    },
  });

  r.queryHandler({
    name: "query-without-hatch",
    schema: z.object({}),
    access: { roles: ["User"] },
    handler: async (_query, ctx) => {
      const runner = ctx.db.unsafeRaw("no escapeHatch declared — must throw before this runs");
      const rows = await executeRawQuery<{ one: number }>(runner, "SELECT 1 AS one");
      return { one: rows[0]?.one };
    },
  });
});

let stack: TestStack;
const user = createTestUser({
  id: 92,
  tenantId: "11111111-0000-4000-8000-000000000092",
  roles: ["User"],
});

beforeAll(async () => {
  stack = await setupTestStack({ features: [unsafeRawFeature] });
});

afterAll(async () => {
  await stack.cleanup();
});

describe("write/query handler escapeHatch gates ctx.db.unsafeRaw()", () => {
  test("write WITH escapeHatch: unsafeRaw succeeds", async () => {
    const result = await stack.http.writeOk<{ one: number }>(
      "unsafe-raw-probe:write:write-with-hatch",
      {},
      user,
    );
    expect(result.one).toBe(1);
  });

  test("write WITHOUT escapeHatch: unsafeRaw fails with access_denied", async () => {
    const err = await stack.http.writeErr("unsafe-raw-probe:write:write-without-hatch", {}, user);
    expect(err.code).toBe("access_denied");
  });

  test("query WITH escapeHatch: unsafeRaw succeeds", async () => {
    const result = await stack.http.queryOk<{ one: number }>(
      "unsafe-raw-probe:query:query-with-hatch",
      {},
      user,
    );
    expect(result.one).toBe(1);
  });

  test("query WITHOUT escapeHatch: unsafeRaw fails with access_denied", async () => {
    const err = await stack.http.queryErr("unsafe-raw-probe:query:query-without-hatch", {}, user);
    expect(err.code).toBe("access_denied");
  });
});
