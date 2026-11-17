// Custom Handlers Sample — Integration Test
// Proves: custom business logic in handlers, payload transformation, custom queries

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { SaveContext } from "@cosmicdrift/kumiko-framework/engine";
import { createTestUser, TestUsers, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { expectErrorIncludes } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
} from "@cosmicdrift/kumiko-testing/stack";
import { counterFeature } from "../feature";

let stack: TestStack;

const admin = TestUsers.admin;
const user = createTestUser({ id: 2, roles: ["User"] });

beforeAll(async () => {
  stack = await setupTestStack({ features: [counterFeature] });
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

describe("custom write handler: create-many", () => {
  test("creates every row with count 0", async () => {
    const { ids } = await stack.http.writeOk<{ ids: string[] }>(
      "counters:write:counter:create-many",
      { names: ["batch-a", "batch-b", "batch-c"] },
      admin,
    );
    expect(ids).toHaveLength(3);

    const names: unknown[] = [];
    for (const id of ids) {
      const row = await stack.http.queryOk<Record<string, unknown>>(
        "counters:query:counter:detail",
        { id },
        admin,
      );
      expect(row["count"]).toBe(0);
      names.push(row["name"]);
    }
    expect(names).toEqual(["batch-a", "batch-b", "batch-c"]);
  });

  test("an invalid name fails the whole batch and writes no row", async () => {
    const error = await stack.http.writeErr(
      "counters:write:counter:create-many",
      { names: ["ok", ""] },
      admin,
    );
    expectErrorIncludes(error, "validation");

    const active = await stack.http.queryOk<{ rows: Record<string, unknown>[] }>(
      "counters:query:counter:active",
      { minCount: 0 },
      admin,
    );
    expect(active.rows.map((row) => row["name"])).not.toContain("ok");
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

describe("named verbs and history", () => {
  type HistoryEntry = { verb: string; at: string };

  async function createCounter(name: string): Promise<string> {
    const created = await stack.http.writeOk<SaveContext>(
      "counters:write:counter:create",
      { name },
      admin,
    );
    return String(created.id);
  }

  function historyOf(id: string): Promise<HistoryEntry[] | null> {
    return stack.http.queryOk<HistoryEntry[] | null>(
      "counters:query:counter:history",
      { id },
      admin,
    );
  }

  test("history lists lifecycle and verb events in order", async () => {
    const id = await createCounter("verb-history");
    await stack.http.writeOk("counters:write:counter:increment", { id, amount: 1 }, admin);
    await stack.http.writeOk("counters:write:counter:archive", { id }, admin);

    expect((await historyOf(id))?.map((entry) => entry.verb)).toEqual([
      "created",
      "updated",
      "archived",
    ]);
  });

  test("archiving twice is an invalid transition", async () => {
    const id = await createCounter("archive-twice");
    await stack.http.writeOk("counters:write:counter:archive", { id }, admin);

    const error = await stack.http.writeErr("counters:write:counter:archive", { id }, admin);

    expectErrorIncludes(error, "invalid_transition");
  });

  test("reset writes the reset verb", async () => {
    const id = await createCounter("verb-reset");
    await stack.http.writeOk("counters:write:counter:reset", { id }, admin);

    expect((await historyOf(id))?.map((entry) => entry.verb)).toEqual(["created", "reset"]);
  });

  test("as-of the created event shows the counter as it was", async () => {
    const id = await createCounter("as-of");
    await stack.http.writeOk("counters:write:counter:increment", { id, amount: 7 }, admin);
    const createdAt = (await historyOf(id))?.find((entry) => entry.verb === "created")?.at;
    if (createdAt === undefined) throw new Error("expected a created entry");

    const rows = await stack.http.queryOk<Record<string, unknown>[]>(
      "counters:query:counter:as-of",
      { asOf: createdAt },
      admin,
    );

    const row = rows.find((candidate) => candidate["id"] === id);
    expect(row?.["count"]).toBe(0);
    expect(row?.["status"]).toBe("open");
  });
});
