import { defineFeature, validateBoot } from "@kumiko/framework/engine";
import { createEventsTable } from "@kumiko/framework/event-store";
import {
  createEntityTable,
  setupTestStack,
  type TestStack,
  TestUsers,
} from "@kumiko/framework/stack";
import { getTableConfig } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { z } from "zod";
import {
  accessControlFeature,
  projectEntity,
  projectTable,
  taskEntity,
  taskTable,
} from "../feature";

let stack: TestStack;
const admin = TestUsers.admin; // { id: 1, tenantId: 1, roles: ["Admin"] }
const user = TestUsers.user; // { id: 2, tenantId: 1, roles: ["User"] }

beforeAll(async () => {
  stack = await setupTestStack({ features: [accessControlFeature] });
  await createEntityTable(stack.db, projectEntity);
  await createEntityTable(stack.db, taskEntity);
  await createEventsTable(stack.db);
});

afterAll(async () => {
  await stack?.cleanup();
});

describe("default-deny: boot-validator refuses handlers without access", () => {
  test("throws on registry boot when any handler lacks an access rule", () => {
    const broken = defineFeature("broken-feature", (r) => {
      r.writeHandler(
        "forgotAccess",
        z.object({ name: z.string() }),
        async () => ({ isSuccess: true as const, data: {} }),
        // No { access: ... } — boot validator must reject this.
      );
    });

    expect(() => validateBoot([broken])).toThrow(/missing an access rule/i);
  });
});

describe("role-based vs openToAll", () => {
  test("Admin-only handler rejects a User caller with access_denied", async () => {
    const raw = await stack.http.write(
      "access-control:write:project:create",
      { name: "Rejected", ownerId: "11111111-0000-4000-8000-000000000001" },
      user,
    );
    const body = (await raw.json()) as { isSuccess: boolean; error?: { code: string } };
    expect(body.isSuccess).toBe(false);
    expect(body.error?.code).toBe("access_denied");
  });

  test("Admin-only handler accepts an Admin caller", async () => {
    await stack.http.writeOk(
      "access-control:write:project:create",
      { name: "Alpha", ownerId: "11111111-0000-4000-8000-000000000001" },
      admin,
    );
  });

  test("openToAll handler accepts any authenticated user", async () => {
    const proj = await stack.http.writeOk<{ data: { id: string } }>(
      "access-control:write:project:create",
      { name: "Shared", ownerId: "11111111-0000-4000-8000-000000000001" },
      admin,
    );
    await stack.http.writeOk(
      "access-control:write:task:create",
      { title: "User's task", projectId: proj.data.id },
      user,
    );
  });
});

describe("auto-indices from relations", () => {
  test("task table has an index on project_id because of the belongsTo relation", () => {
    const { indexes } = getTableConfig(taskTable);
    const names = indexes.map((i) => i.config.name);

    expect(names).toContain("read_ac_tasks_tenant_id_idx");
    expect(names).toContain("read_ac_tasks_project_id_idx");
  });

  test("project table has only the tenant_id index (no belongsTo relations)", () => {
    const { indexes } = getTableConfig(projectTable);
    expect(indexes.map((i) => i.config.name)).toEqual(["read_ac_projects_tenant_id_idx"]);
  });
});

describe("optimistic locking: version required in update schema", () => {
  test("update without version fails schema validation before reaching the crud executor", async () => {
    const proj = await stack.http.writeOk<{ data: { id: string } }>(
      "access-control:write:project:create",
      { name: "VersionedProject", ownerId: "11111111-0000-4000-8000-000000000001" },
      admin,
    );
    const created = await stack.http.writeOk<{ data: { id: string } }>(
      "access-control:write:task:create",
      { title: "Needs version", projectId: proj.data.id },
      user,
    );

    const raw = await stack.http.write(
      "access-control:write:task:update",
      // Missing `version` — schema rejects before any DB call.
      { id: created.data.id, changes: { title: "Updated" } },
      user,
    );
    const body = (await raw.json()) as { isSuccess: boolean; error?: { code: string } };
    expect(body.isSuccess).toBe(false);
    expect(body.error?.code).toBe("validation_error");
  });

  test("update with correct version succeeds", async () => {
    const proj = await stack.http.writeOk<{ data: { id: string } }>(
      "access-control:write:project:create",
      { name: "VersionedOk", ownerId: "11111111-0000-4000-8000-000000000001" },
      admin,
    );
    const created = await stack.http.writeOk<{ data: { id: string } }>(
      "access-control:write:task:create",
      { title: "Task v1", projectId: proj.data.id },
      user,
    );

    await stack.http.writeOk(
      "access-control:write:task:update",
      { id: created.data.id, version: 1, changes: { title: "Task v2" } },
      user,
    );
  });
});

// Ensures this sample is wired through the full stack — if any of its
// handlers regress to missing access or broken schemas, boot or this list
// query will fail loudly.
describe("end-to-end", () => {
  test("list returns seeded tasks across users", async () => {
    const proj = await stack.http.writeOk<{ data: { id: string } }>(
      "access-control:write:project:create",
      { name: "ListTarget", ownerId: "11111111-0000-4000-8000-000000000001" },
      admin,
    );

    await stack.http.writeOk(
      "access-control:write:task:create",
      { title: "t1", projectId: proj.data.id },
      user,
    );
    await stack.http.writeOk(
      "access-control:write:task:create",
      { title: "t2", projectId: proj.data.id },
      admin,
    );

    const list = await stack.http.queryOk<{ rows: Record<string, unknown>[] }>(
      "access-control:query:task:list",
      {},
      user,
    );
    expect(list.rows.length).toBeGreaterThanOrEqual(2);
  });
});
