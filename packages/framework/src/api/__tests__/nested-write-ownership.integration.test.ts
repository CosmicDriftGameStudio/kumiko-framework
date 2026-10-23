// Nested-write parent-row ownership check. A custom (non-executor)
// `:create` handler can hand back an EXISTING row instead of inserting a
// fresh one (find-or-create, or a bug) — the framework must refuse to attach
// nested children to a parent row the caller does not own, both across
// tenants (role-only entity, no ownership field) and within a tenant (an
// ownership-bound field pointing at a different owner). Modelled on
// nested-write.integration.test.ts's project/task fixture. Real HTTP via
// setupTestStack + stack.http.write — never createTestDispatcher.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { resetTestTables } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import * as z from "zod";
import { createEventStoreExecutor } from "../../db/event-store-executor.ts";
import { executeRawQuery } from "../../db/queries/raw-sql.ts";
import { selectMany } from "../../db/query.ts";
import { buildEntityTable } from "../../db/table-builder.ts";
import {
  createEntity,
  createTextField,
  defineFeature,
  from,
  SYSTEM_TENANT_ID,
} from "../../engine/index.ts";
import { eventsTable } from "../../event-store/index.ts";
import { createTestUser, testTenantId } from "../../seeding/seed-users.ts";

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
  r.entity({ name: "project2", ...project2Entity });
  r.entity({ name: "task2", ...task2Entity });
  r.relation("project2", "tasks", {
    type: "hasMany",
    target: "task2",
    foreignKey: "projectId",
    nestedWrite: true,
  });

  r.entity({ name: "project3", ...project3Entity });
  r.entity({ name: "task3", ...task3Entity });
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
  r.writeHandler({
    name: "project2:create",
    schema: z.object({
      name: z.string().min(1),
      ownerId: z.string().uuid().optional(),
      returnPartialRow: z.boolean().optional(),
    }),
    handler: async (event, ctx) => {
      const existing = await ctx.db.fetchOne(project2Table, { name: event.payload.name });
      if (existing) {
        // A projection without the ownership-bound field.
        return {
          isSuccess: true as const,
          data: event.payload.returnPartialRow
            ? { id: existing["id"], name: existing["name"] }
            : existing,
        };
      }
      const crud = createEventStoreExecutor(project2Table, project2Entity, {
        entityName: "project2",
      });
      return crud.create(
        { name: event.payload.name, ownerId: event.payload.ownerId ?? event.user.id },
        event.user,
        ctx.db,
      );
    },
    access: { roles: ["Admin", "User"] },
  });

  r.writeHandler({
    name: "task2:create",
    schema: z.object({ projectId: z.string().uuid(), title: z.string().min(1) }),
    handler: async (event, ctx) => {
      const crud = createEventStoreExecutor(task2Table, task2Entity, { entityName: "task2" });
      return crud.create(event.payload, event.user, ctx.db);
    },
    access: { roles: ["Admin", "User"] },
  });

  // Custom find-or-create for the cross-tenant scenario: an unfiltered raw
  // lookup by name (declared escapeHatch) simulates a handler bug that finds
  // a same-named row belonging to a DIFFERENT tenant and hands it back
  // instead of inserting a fresh, tenant-scoped row.
  r.writeHandler({
    name: "project3:create",
    schema: z.object({ name: z.string().min(1), omitTenantId: z.boolean().optional() }),
    handler: async (event, ctx) => {
      const runner = ctx.db.unsafeRaw();
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
          // A row without a tenantId key cannot be checked from the payload alone.
          data: event.payload.omitTenantId
            ? { id: existing.id, name: existing.name }
            : { id: existing.id, name: existing.name, tenantId: existing.tenant_id },
        };
      }
      const crud = createEventStoreExecutor(project3Table, project3Entity, {
        entityName: "project3",
      });
      return crud.create({ name: event.payload.name }, event.user, ctx.db);
    },
    access: { roles: ["Admin", "User"] },
    escapeHatch: { reason: "fw#2861 test fixture — simulate cross-tenant find-or-create bug" },
  });

  r.writeHandler({
    name: "task3:create",
    schema: z.object({ projectId: z.string().uuid(), title: z.string().min(1) }),
    handler: async (event, ctx) => {
      const crud = createEventStoreExecutor(task3Table, task3Entity, { entityName: "task3" });
      return crud.create(event.payload, event.user, ctx.db);
    },
    access: { roles: ["Admin", "User"] },
  });
});

let stack: TestStack;
const TENANT_A = testTenantId(9101);
const TENANT_B = testTenantId(9102);
const ownerUser = createTestUser({ id: 9111, tenantId: TENANT_A, roles: ["User"] });
const attackerUser = createTestUser({ id: 9112, tenantId: TENANT_A, roles: ["User"] });
const tenantAOtherUser = createTestUser({ id: 9114, tenantId: TENANT_A, roles: ["User"] });
const tenantBUser = createTestUser({ id: 9113, tenantId: TENANT_B, roles: ["User"] });

beforeAll(async () => {
  // Off on purpose: the fixture simulates a handler bug that returns a foreign tenant's parent row; with
  // policies the database hides that row first, so the application-level ownership check would never run.
  stack = await setupTestStack({ features: [nestedOwnershipFeature], rowLevelSecurity: "off" });
  await unsafeCreateEntityTable(stack.db, project2Entity, "project2");
  await unsafeCreateEntityTable(stack.db, task2Entity, "task2");
  await unsafeCreateEntityTable(stack.db, project3Entity, "project3");
  await unsafeCreateEntityTable(stack.db, task3Entity, "task3");
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await resetTestTables(stack.db, [
    task2Table,
    task3Table,
    project2Table,
    project3Table,
    eventsTable,
  ]);
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

  test("(a2) cross-tenant parent row returned WITHOUT tenantId key -> access_denied, zero task rows (#2912)", async () => {
    const seedRes = await stack.http.write(
      "nested-own:write:project3:create",
      { name: "cross-tenant-bare" },
      tenantBUser,
    );
    expect(seedRes.status).toBe(200);

    const res = await stack.http.write(
      "nested-own:write:project3:create",
      { name: "cross-tenant-bare", omitTenantId: true, tasks: [{ title: "t1" }] },
      tenantAOtherUser,
    );

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("access_denied");
    expect(await selectMany(stack.db, task3Table)).toHaveLength(0);
  });

  test("(a3) SYSTEM-tenant parent row returned WITHOUT tenantId key -> access_denied, zero task rows", async () => {
    const systemUser = createTestUser({ id: 9115, tenantId: SYSTEM_TENANT_ID, roles: ["User"] });
    const seedRes = await stack.http.write(
      "nested-own:write:project3:create",
      { name: "system-bare" },
      systemUser,
    );
    expect(seedRes.status).toBe(200);

    const res = await stack.http.write(
      "nested-own:write:project3:create",
      { name: "system-bare", omitTenantId: true, tasks: [{ title: "t1" }] },
      tenantAOtherUser,
    );

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("access_denied");
    expect(await selectMany(stack.db, task3Table)).toHaveLength(0);
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

  test("(d) partial parent row without the ownership field is checked against the stored row", async () => {
    const seedRes = await stack.http.write(
      "nested-own:write:project2:create",
      { name: "partial-row" },
      ownerUser,
    );
    expect(seedRes.status).toBe(200);

    const denied = await stack.http.write(
      "nested-own:write:project2:create",
      { name: "partial-row", returnPartialRow: true, tasks: [{ title: "t1" }] },
      attackerUser,
    );
    expect(denied.status).toBe(403);
    expect((await denied.json()).error.code).toBe("access_denied");
    expect(await selectMany(stack.db, task2Table)).toHaveLength(0);

    const allowed = await stack.http.write(
      "nested-own:write:project2:create",
      { name: "partial-row", returnPartialRow: true, tasks: [{ title: "t1" }] },
      ownerUser,
    );
    expect(allowed.status).toBe(200);
    expect(await selectMany(stack.db, task2Table)).toHaveLength(1);
  });
});
