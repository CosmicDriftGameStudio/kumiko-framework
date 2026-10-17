// Custom Handlers Sample — Integration Test
// Proves: custom business logic in handlers, payload transformation, custom queries

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { SaveContext } from "@cosmicdrift/kumiko-framework/engine";
import { createEventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  TestUsers,
  testTenantId,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { expectErrorIncludes } from "@cosmicdrift/kumiko-framework/testing";
import { counterEntity, counterFeature } from "../feature";

let stack: TestStack;

const admin = TestUsers.admin;
const user = createTestUser({ id: 2, roles: ["User"] });

beforeAll(async () => {
  stack = await setupTestStack({ features: [counterFeature] });
  await unsafeCreateEntityTable(stack.db, counterEntity);
  await createEventsTable(stack.db);
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(() => {
  stack.events.reset();
});

describe("custom write handler: increment", () => {
  test("increment adds to existing count", async () => {
    const created = await stack.http.writeOk<SaveContext>(
      "counters:write:counter:create",
      {
        name: "page-views",
      },
      admin,
    );
    expect(created.data["count"]).toBe(0);

    const incremented = await stack.http.writeOk<SaveContext>(
      "counters:write:counter:increment",
      {
        id: created.id,
        amount: 5,
      },
      user,
    );

    expect(incremented.data["count"]).toBe(5);
    expect(incremented.data["lastIncrementedBy"]).toBe(`user:${user.id}`);
  });

  test("multiple increments accumulate", async () => {
    const created = await stack.http.writeOk<SaveContext>(
      "counters:write:counter:create",
      {
        name: "clicks",
      },
      admin,
    );

    await stack.http.writeOk<SaveContext>(
      "counters:write:counter:increment",
      {
        id: created.id,
        amount: 3,
      },
      user,
    );
    const result = await stack.http.writeOk<SaveContext>(
      "counters:write:counter:increment",
      {
        id: created.id,
        amount: 7,
      },
      user,
    );

    expect(result.data["count"]).toBe(10);
  });

  test("increment validates max amount", async () => {
    const created = await stack.http.writeOk<SaveContext>(
      "counters:write:counter:create",
      {
        name: "guarded",
      },
      admin,
    );

    const error = await stack.http.writeErr(
      "counters:write:counter:increment",
      {
        id: created.id,
        amount: 101,
      },
      user,
    );
    expectErrorIncludes(error, "validation");
  });

  test("increment on non-existent returns error", async () => {
    const error = await stack.http.writeErr(
      "counters:write:counter:increment",
      {
        id: "00000000-0000-4000-8000-000000000999",
        amount: 1,
      },
      user,
    );
    expect(error.code).toBe("not_found");
  });
});

describe("custom write handler: reset", () => {
  test("reset sets count back to zero", async () => {
    const created = await stack.http.writeOk<SaveContext>(
      "counters:write:counter:create",
      {
        name: "resettable",
      },
      admin,
    );

    await stack.http.writeOk<SaveContext>(
      "counters:write:counter:increment",
      {
        id: created.id,
        amount: 42,
      },
      user,
    );

    const reset = await stack.http.writeOk<SaveContext>(
      "counters:write:counter:reset",
      {
        id: created.id,
      },
      admin,
    );

    expect(reset.data["count"]).toBe(0);
    expect(reset.data["lastIncrementedBy"]).toBe("");
  });

  test("only Admin can reset", async () => {
    const created = await stack.http.writeOk<SaveContext>(
      "counters:write:counter:create",
      {
        name: "admin-only-reset",
      },
      admin,
    );

    const error = await stack.http.writeErr(
      "counters:write:counter:reset",
      {
        id: created.id,
      },
      user,
    );
    expect(error.code).toBe("access_denied");
  });
});

describe("custom query handler: active counters", () => {
  // Own tenants: the total assertions would otherwise count counters created by other tests.
  const activeAdmin = createTestUser({ roles: ["Admin"], tenantId: testTenantId(11) });
  const activeUser = createTestUser({ id: 2, roles: ["User"], tenantId: testTenantId(11) });
  const otherAdmin = createTestUser({ roles: ["Admin"], tenantId: testTenantId(12) });

  test("filters counters by minimum count", async () => {
    const c1 = await stack.http.writeOk<SaveContext>(
      "counters:write:counter:create",
      { name: "active-a" },
      activeAdmin,
    );
    const c2 = await stack.http.writeOk<SaveContext>(
      "counters:write:counter:create",
      { name: "active-b" },
      activeAdmin,
    );
    await stack.http.writeOk<SaveContext>(
      "counters:write:counter:create",
      { name: "inactive" },
      activeAdmin,
    );

    await stack.http.writeOk<SaveContext>(
      "counters:write:counter:increment",
      { id: c1.id, amount: 10 },
      activeUser,
    );
    await stack.http.writeOk<SaveContext>(
      "counters:write:counter:increment",
      { id: c2.id, amount: 5 },
      activeUser,
    );

    const result = await stack.http.queryOk<{
      rows: Record<string, unknown>[];
      nextCursor: string | null;
      total?: number;
    }>("counters:query:counter:active", { minCount: 5 }, activeAdmin);

    const names = result.rows.map((r) => r["name"]);
    expect(names).toContain("active-a");
    expect(names).toContain("active-b");
    expect(names).not.toContain("inactive");
    expect(result.total).toBe(2);
  });

  test("total and nextCursor describe the full filtered set", async () => {
    for (const name of ["total-a", "total-b", "total-c"]) {
      const created = await stack.http.writeOk<SaveContext>(
        "counters:write:counter:create",
        { name },
        otherAdmin,
      );
      await stack.http.writeOk<SaveContext>(
        "counters:write:counter:increment",
        { id: created.id, amount: 1 },
        otherAdmin,
      );
    }
    await stack.http.writeOk<SaveContext>(
      "counters:write:counter:create",
      { name: "total-untouched" },
      otherAdmin,
    );

    const result = await stack.http.queryOk<{
      rows: Record<string, unknown>[];
      nextCursor: string | null;
      total?: number;
    }>("counters:query:counter:active", { minCount: 1 }, otherAdmin);

    expect(result.rows).toHaveLength(3);
    expect(result.total).toBe(3);
    expect(result.nextCursor).toBeNull();
  });
});
