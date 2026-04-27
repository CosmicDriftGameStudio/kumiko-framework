// Basic CRUD Sample — Integration Test
// Proves: create, read, update, delete, soft delete, optimistic locking, sort

import { createEventsTable } from "@kumiko/framework/event-store";
import {
  createEntityTable,
  createTestUser,
  setupTestStack,
  type TestStack,
  TestUsers,
} from "@kumiko/framework/stack";
import { expectErrorIncludes } from "@kumiko/framework/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { taskEntity, taskFeature } from "../feature";

let stack: TestStack;

const admin = TestUsers.admin;
const user = createTestUser({ id: 2, roles: ["User"] });

beforeAll(async () => {
  stack = await setupTestStack({ features: [taskFeature] });
  await createEntityTable(stack.db, taskEntity);
  await createEventsTable(stack.db);
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(() => {
  stack.events.reset();
});

// --- Create + Read ---

describe("create and read", () => {
  test("create returns SaveContext with isNew=true", async () => {
    const data = await stack.http.writeOk(
      "tasks:write:task:create",
      {
        title: "Buy milk",
        description: "From the store",
      },
      admin,
    );

    expect(data.isNew).toBe(true);
    expect(data.id).toBeDefined();
    expect(data.data["title"]).toBe("Buy milk");
    expect(data.data["version"]).toBe(1);
  });

  test("detail returns created record", async () => {
    const created = await stack.http.writeOk(
      "tasks:write:task:create",
      {
        title: "Read me back",
      },
      admin,
    );

    const detail = await stack.http.queryOk<Record<string, unknown>>(
      "tasks:query:task:detail",
      { id: created.id },
      admin,
    );

    expect(detail["title"]).toBe("Read me back");
    expect(detail["version"]).toBe(1);
  });

  test("boolean default applied", async () => {
    const created = await stack.http.writeOk(
      "tasks:write:task:create",
      {
        title: "Defaults test",
      },
      admin,
    );

    expect(created.data["isArchived"]).toBe(false);
  });
});

// --- Update ---

describe("update", () => {
  test("update returns changes and previous", async () => {
    const created = await stack.http.writeOk(
      "tasks:write:task:create",
      {
        title: "Before",
        status: "todo",
      },
      admin,
    );

    const updated = await stack.http.writeOk(
      "tasks:write:task:update",
      {
        id: created.id,
        changes: { title: "After" },
        version: 1,
      },
      user,
    );

    expect(updated.isNew).toBe(false);
    expect(updated.changes).toEqual({ title: "After" });
    expect(updated.previous["title"]).toBe("Before");
    expect(updated.data["title"]).toBe("After");
    expect(updated.data["status"]).toBe("todo"); // unchanged field preserved
  });

  test("version increments on update", async () => {
    const created = await stack.http.writeOk(
      "tasks:write:task:create",
      {
        title: "Versioned",
      },
      admin,
    );

    const updated = await stack.http.writeOk(
      "tasks:write:task:update",
      {
        id: created.id,
        changes: { title: "V2" },
        version: 1,
      },
      admin,
    );

    expect(updated.data["version"]).toBe(2);
  });
});

// --- Optimistic Locking ---

describe("optimistic locking", () => {
  test("stale version causes version_conflict", async () => {
    const created = await stack.http.writeOk(
      "tasks:write:task:create",
      {
        title: "Lock me",
      },
      admin,
    );

    // First update succeeds
    await stack.http.writeOk(
      "tasks:write:task:update",
      {
        id: created.id,
        version: 1,
        changes: { title: "V2" },
      },
      admin,
    );

    // Second update with stale version=1 fails
    const error = await stack.http.writeErr(
      "tasks:write:task:update",
      {
        id: created.id,
        version: 1,
        changes: { title: "Stale" },
      },
      admin,
    );

    expectErrorIncludes(error, "version_conflict");
  });
});

// --- Soft Delete ---

describe("soft delete", () => {
  test("deleted record disappears from detail", async () => {
    const created = await stack.http.writeOk(
      "tasks:write:task:create",
      {
        title: "Delete me",
      },
      admin,
    );

    await stack.http.writeOk("tasks:write:task:delete", { id: created.id }, admin);

    const detail = await stack.http.queryOk<null>(
      "tasks:query:task:detail",
      { id: created.id },
      admin,
    );
    expect(detail).toBeNull();
  });

  test("deleted record disappears from list", async () => {
    const created = await stack.http.writeOk(
      "tasks:write:task:create",
      {
        title: "Unique-Del-List-Check",
      },
      admin,
    );

    await stack.http.writeOk("tasks:write:task:delete", { id: created.id }, admin);

    const list = await stack.http.queryOk<{ rows: Record<string, unknown>[] }>(
      "tasks:query:task:list",
      {},
      admin,
    );
    expect(list.rows.some((r) => r["title"] === "Unique-Del-List-Check")).toBe(false);
  });
});

// --- List + Sort ---

describe("list and sort", () => {
  test("list returns rows", async () => {
    await stack.http.writeOk("tasks:write:task:create", { title: "List-A" }, admin);
    await stack.http.writeOk("tasks:write:task:create", { title: "List-B" }, admin);

    const list = await stack.http.queryOk<{ rows: Record<string, unknown>[] }>(
      "tasks:query:task:list",
      {},
      admin,
    );
    expect(list.rows.length).toBeGreaterThanOrEqual(2);
  });

  test("sort by status ASC", async () => {
    await stack.http.writeOk(
      "tasks:write:task:create",
      { title: "Sort-Z", status: "z-last" },
      admin,
    );
    await stack.http.writeOk(
      "tasks:write:task:create",
      { title: "Sort-A", status: "a-first" },
      admin,
    );

    const list = await stack.http.queryOk<{ rows: Record<string, unknown>[] }>(
      "tasks:query:task:list",
      { sort: "status", sortDirection: "asc" },
      admin,
    );

    const statuses = list.rows.map((r) => r["status"]).filter(Boolean) as string[];
    const sorted = [...statuses].sort();
    expect(statuses).toEqual(sorted);
  });
});

// --- Access Control ---

describe("access control", () => {
  test("User role can create", async () => {
    const data = await stack.http.writeOk(
      "tasks:write:task:create",
      {
        title: "User task",
      },
      user,
    );
    expect(data.isNew).toBe(true);
  });

  test("User role cannot delete (Admin only)", async () => {
    const created = await stack.http.writeOk(
      "tasks:write:task:create",
      {
        title: "Protected",
      },
      admin,
    );

    const error = await stack.http.writeErr(
      "tasks:write:task:delete",
      {
        id: created.id,
      },
      user,
    );
    expect(error.code).toBe("access_denied");
  });
});
