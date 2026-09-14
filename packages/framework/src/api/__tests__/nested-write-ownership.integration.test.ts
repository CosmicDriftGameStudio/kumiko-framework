// fw#2861 — nested-write parent-row ownership check. A custom (non-executor)
// `:create` handler can hand back an EXISTING row instead of inserting a
// fresh one (find-or-create, or a bug) — the framework must refuse to attach
// nested children to a parent row the caller does not own, both across
// tenants (role-only entity, no ownership field) and within a tenant (an
// ownership-bound field pointing at a different owner). Modelled on
// nested-write.integration.test.ts's project/task fixture. Real HTTP via
// setupTestStack + stack.http.write — never createTestDispatcher.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { z } from "zod";
import { createEventStoreExecutor } from "../../db/event-store-executor";
import { executeRawQuery } from "../../db/queries/raw-sql";
import { asRawClient, selectMany } from "../../db/query";
import { buildEntityTable } from "../../db/table-builder";
import { createEntity, createTextField, defineFeature, from } from "../../engine";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  testTenantId,
  unsafeCreateEntityTable,
} from "../../stack";

// project2/task2: same-tenant ownership scenario (b/c). ownerId is an
// ownership-bound field — checkWriteFieldOwnership evaluates it.
const project2Entity = createEntity({
  table: "nested_own_projects2",
  fields: {
    name: createTextField({ personal: false, reason: "test_fixture", required: true }),
    ownerId: createTextField({
      personal: false,
      reason: "test_fixture",
      required: true,
      access: { write: { User: from("user:id", "ownerId") } },
    }),
  },
});
const project2Table = buildEntityTable("project2", project2Entity);

const task2Entity = createEntity({
  table: "nested_own_tasks2",
  fields: {
    projectId: createTextField({ personal: false, reason: "test_fixture", required: true }),
    title: createTextField({ personal: false, reason: "test_fixture", required: true }),
  },
});
const task2Table = buildEntityTable("task2", task2Entity);

// project3/task3: cross-tenant scenario (a). Role-only entity, no ownership
// field — checkWriteFieldOwnership is a no-op here; only the tenant check
// can catch it.
const project3Entity = createEntity({
  table: "nested_own_projects3",
  fields: {
    name: createTextField({ personal: false, reason: "test_fixture", required: true }),
  },
});
const project3Table = buildEntityTable("project3", project3Entity);

const task3Entity = createEntity({
  table: "nested_own_tasks3",
  fields: {
    projectId: createTextField({ personal: false, reason: "test_fixture", required: true }),
    title: createTextField({ personal: false, reason: "test_fixture", required: true }),
  },
});
const task3Table = buildEntityTable("task3", task3Entity);

const nestedOwnershipFeature = defineFeature("nested-own", (r) => {
  r.entity("project2", project2Entity);
  r.entity("task2", task2Entity);
  r.relation("project2", "tasks", {
    type: "hasMany",
    target: "task2",
    foreignKey: "projectId",
    nestedWrite: true,
  });

  r.entity("project3", project3Entity);
  r.entity("task3", task3Entity);
  r.relation("project3", "tasks", {
    type: "hasMany",
    target: "task3",
    foreignKey: "projectId",
    nestedWrite: true,
  });

  // Custom (non-executor-entry) find-or-create: same-tenant only (tenant-
  // scoped fetchOne), simulating a handler that doesn't strictly insert a
  // fresh row every time — only the "found" branch skips the executor.
  // No escapeHatch needed — the lookup stays within the caller's own tenant.
  r.writeHandler(
    "project2:create",
    z.object({ name: z.string().min(1), ownerId: z.string().uuid().optional() }),
    async (event, ctx) => {
      const existing = await ctx.db.fetchOne(project2Table, { name: event.payload.name });
      if (existing) return { isSuccess: true as const, data: existing };
      const crud = createEventStoreExecutor(project2Table, project2Entity, {
        entityName: "project2",
      });
      return crud.create(
        { name: event.payload.name, ownerId: event.payload.ownerId ?? event.user.id },
        event.user,
        ctx.db,
      );
    },
    { access: { roles: ["Admin", "User"] } },
  );

  r.writeHandler(
    "task2:create",
    z.object({ projectId: z.string().uuid(), title: z.string().min(1) }),
    async (event, ctx) => {
      const crud = createEventStoreExecutor(task2Table, task2Entity, { entityName: "task2" });
      return crud.create(event.payload, event.user, ctx.db);
    },
    { access: { roles: ["Admin", "User"] } },
  );

  // Custom find-or-create for the cross-tenant scenario: an unfiltered raw
  // lookup by name (declared escapeHatch) simulates a handler bug that finds
  // a same-named row belonging to a DIFFERENT tenant and hands it back
  // instead of inserting a fresh, tenant-scoped row.
  r.writeHandler(
    "project3:create",
    z.object({ name: z.string().min(1) }),
    async (event, ctx) => {
      const runner = ctx.db.unsafeRaw(
        "fw#2861 test fixture — simulate cross-tenant find-or-create bug",
      );
      const rows = await executeRawQuery<{
        id: string;
        name: string;
        tenant_id: string;
      }>(
        runner,
        `SELECT id, name, tenant_id FROM "${project3Table.tableName}" WHERE name = $1 LIMIT 1`,
        [event.payload.name],
      );
      const existing = rows[0];
      if (existing) {
        return {
          isSuccess: true as const,
          data: { id: existing.id, name: existing.name, tenantId: existing.tenant_id },
        };
      }
      const crud = createEventStoreExecutor(project3Table, project3Entity, {
        entityName: "project3",
      });
      return crud.create({ name: event.payload.name }, event.user, ctx.db);
    },
    {
      access: { roles: ["Admin", "User"] },
      escapeHatch: { reason: "fw#2861 test fixture — simulate cross-tenant find-or-create bug" },
    },
  );

  r.writeHandler(
    "task3:create",
    z.object({ projectId: z.string().uuid(), title: z.string().min(1) }),
    async (event, ctx) => {
      const crud = createEventStoreExecutor(task3Table, task3Entity, { entityName: "task3" });
      return crud.create(event.payload, event.user, ctx.db);
    },
    { access: { roles: ["Admin", "User"] } },
  );
});

let stack: TestStack;
const TENANT_A = testTenantId(9101);
const TENANT_B = testTenantId(9102);
const ownerUser = createTestUser({ id: 9111, tenantId: TENANT_A, roles: ["User"] });
const attackerUser = createTestUser({ id: 9112, tenantId: TENANT_A, roles: ["User"] });
const tenantAOtherUser = createTestUser({ id: 9114, tenantId: TENANT_A, roles: ["User"] });
const tenantBUser = createTestUser({ id: 9113, tenantId: TENANT_B, roles: ["User"] });

beforeAll(async () => {
  stack = await setupTestStack({ features: [nestedOwnershipFeature] });
  await unsafeCreateEntityTable(stack.db, project2Entity, "project2");
  await unsafeCreateEntityTable(stack.db, task2Entity, "task2");
  await unsafeCreateEntityTable(stack.db, project3Entity, "project3");
  await unsafeCreateEntityTable(stack.db, task3Entity, "task3");
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await asRawClient(stack.db).unsafe(`DELETE FROM "${task2Table.tableName}"`);
  await asRawClient(stack.db).unsafe(`DELETE FROM "${task3Table.tableName}"`);
  await asRawClient(stack.db).unsafe(`DELETE FROM "${project2Table.tableName}"`);
  await asRawClient(stack.db).unsafe(`DELETE FROM "${project3Table.tableName}"`);
});

describe("nested-write parent-row ownership check (fw#2861)", () => {
  test("(a) cross-tenant: existing role-only parent row in tenant B, tenant-A caller -> access_denied, zero task rows", async () => {
    // Seed the foreign row in tenant B.
    const seedRes = await stack.http.write(
      "nested-own:write:project3:create",
      { name: "cross-tenant" },
      tenantBUser,
    );
    expect(seedRes.status).toBe(200);

    const res = await stack.http.write(
      "nested-own:write:project3:create",
      { name: "cross-tenant", tasks: [{ title: "t1" }] },
      tenantAOtherUser,
    );

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    const body = await res.json();
    expect(body.isSuccess).toBe(false);
    expect(body.error.code).toBe("access_denied");

    const dbTasks = await selectMany(stack.db, task3Table);
    expect(dbTasks).toHaveLength(0);
  });

  test("(b) same tenant, ownership-bound field, row owned by a different user -> access_denied, zero task rows", async () => {
    const seedRes = await stack.http.write(
      "nested-own:write:project2:create",
      { name: "owned-by-other" },
      ownerUser,
    );
    expect(seedRes.status).toBe(200);

    const res = await stack.http.write(
      "nested-own:write:project2:create",
      { name: "owned-by-other", tasks: [{ title: "t1" }] },
      attackerUser,
    );

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    const body = await res.json();
    expect(body.isSuccess).toBe(false);
    expect(body.error.code).toBe("access_denied");

    const dbTasks = await selectMany(stack.db, task2Table);
    expect(dbTasks).toHaveLength(0);
  });

  test("(c) caller owns the existing same-tenant row -> children attach (regression)", async () => {
    const seedRes = await stack.http.write(
      "nested-own:write:project2:create",
      { name: "owned-by-self" },
      ownerUser,
    );
    expect(seedRes.status).toBe(200);

    const res = await stack.http.write(
      "nested-own:write:project2:create",
      { name: "owned-by-self", tasks: [{ title: "t1" }] },
      ownerUser,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.isSuccess).toBe(true);

    const dbTasks = await selectMany(stack.db, task2Table);
    expect(dbTasks).toHaveLength(1);
  });
});
