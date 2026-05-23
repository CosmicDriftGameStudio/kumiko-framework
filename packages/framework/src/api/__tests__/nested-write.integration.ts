import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { z } from "zod";
import { asRawClient, selectMany } from "../../bun-db/query";
import { createEventStoreExecutor } from "../../db/event-store-executor";
import { buildEntityTable } from "../../db/table-builder";
import { createEntity, createTextField, defineFeature } from "../../engine";
import { setupTestStack, type TestStack, TestUsers, unsafeCreateEntityTable } from "../../stack";

// Two entities in a 1:N relation. The relation is declared with
// `nestedWrite: true`, which opts the framework into expanding
// `{ tasks: [...] }` inside a project:create payload into a child-write
// per entry — all in the same TX as the parent.
const projectEntity = createEntity({
  table: "nested_projects",
  fields: { name: createTextField({ required: true }) },
});
const projectTable = buildEntityTable("project", projectEntity);

const taskEntity = createEntity({
  table: "nested_tasks",
  fields: {
    projectId: createTextField({ required: true }),
    title: createTextField({ required: true }),
  },
});
const taskTable = buildEntityTable("task", taskEntity);

const nestedFeature = defineFeature("nested", (r) => {
  r.entity("project", projectEntity);
  r.entity("task", taskEntity);

  r.relation("project", "tasks", {
    type: "hasMany",
    target: "task",
    foreignKey: "projectId",
    nestedWrite: true,
  });

  r.writeHandler(
    "project:create",
    z.object({ name: z.string().min(1) }),
    async (event, ctx) => {
      const crud = createEventStoreExecutor(projectTable, projectEntity, {
        entityName: "project",
      });
      return crud.create(event.payload, event.user, ctx.db);
    },
    { access: { roles: ["Admin"] } },
  );

  r.writeHandler(
    "task:create",
    z.object({
      projectId: z.string().uuid(),
      title: z.string().min(1),
    }),
    async (event, ctx) => {
      const crud = createEventStoreExecutor(taskTable, taskEntity, {
        entityName: "task",
      });
      return crud.create(event.payload, event.user, ctx.db);
    },
    { access: { roles: ["Admin"] } },
  );
});

let stack: TestStack;
const admin = TestUsers.admin;

beforeAll(async () => {
  stack = await setupTestStack({ features: [nestedFeature] });
  await unsafeCreateEntityTable(stack.db, projectEntity);
  await unsafeCreateEntityTable(stack.db, taskEntity);
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await asRawClient(stack.db).unsafe(`DELETE FROM "${taskTable.tableName}"`);
  await asRawClient(stack.db).unsafe(`DELETE FROM "${projectTable.tableName}"`);
});

describe("POST /api/write — nested-write (Welle M1)", () => {
  test("project:create with nested tasks: parent + children atomic, response carries both", async () => {
    const res = await stack.http.write(
      "nested:write:project:create",
      {
        name: "P1",
        tasks: [{ title: "t1" }, { title: "t2" }],
      },
      admin,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.isSuccess).toBe(true);

    // Handlers built on the CRUD executor wrap the row in a SaveContext
    // (`{ kind: "save", data: <row>, ... }`). Nested children land on the
    // inner `data` object, mirroring the nested shape the client sent up.
    const parent = body.data.data;
    expect(parent.id).toBeDefined();
    expect(parent.name).toBe("P1");
    expect(Array.isArray(parent.tasks)).toBe(true);
    expect(parent.tasks).toHaveLength(2);
    expect(parent.tasks[0].projectId).toBe(parent.id);
    expect(parent.tasks[0].title).toBe("t1");
    expect(parent.tasks[1].projectId).toBe(parent.id);
    expect(parent.tasks[1].title).toBe("t2");

    // DB reflects both writes.
    const dbProjects = await selectMany(stack.db, projectTable);
    const dbTasks = await selectMany(stack.db, taskTable, { projectId: parent.id });
    expect(dbProjects).toHaveLength(1);
    expect(dbTasks).toHaveLength(2);
  });

  test("sub-write failure rolls back parent: neither project nor sibling tasks persist", async () => {
    // Second task fails zod validation (empty title). The whole batch —
    // parent + any prior sub — must roll back.
    const res = await stack.http.write(
      "nested:write:project:create",
      {
        name: "P2",
        tasks: [{ title: "ok" }, { title: "" }],
      },
      admin,
    );

    expect(res.status).toBeGreaterThanOrEqual(400);
    const body = await res.json();
    expect(body.isSuccess).toBe(false);

    // DB empty — prior sub-task and parent both rolled back.
    const dbProjects = await selectMany(stack.db, projectTable);
    const dbTasks = await selectMany(stack.db, taskTable);
    expect(dbProjects).toHaveLength(0);
    expect(dbTasks).toHaveLength(0);
  });

  test("sub-write validation error paths are prefixed with `<relKey>.<index>`", async () => {
    // A zod failure on a nested item (empty title) must surface with a
    // client-mappable path. The form-controller (Block 2) keys error
    // messages off this path to highlight the right sub-line's field.
    const res = await stack.http.write(
      "nested:write:project:create",
      {
        name: "P4",
        tasks: [{ title: "ok" }, { title: "" }],
      },
      admin,
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("validation_error");
    const paths = (body.error.details.fields as Array<{ path: string }>).map((f) => f.path);
    // At least one field issue points at tasks.1.title (index-1, empty title).
    expect(paths.some((p) => p === "tasks.1.title")).toBe(true);
  });

  test("non-array value under a nested-write key is rejected (invalid_type)", async () => {
    // Zod's default semantics would silently strip a malformed `tasks` value
    // (e.g. a string or null) — the client would then see a 200 with no
    // indication their data was dropped. Fail loud instead.
    const res = await stack.http.write(
      "nested:write:project:create",
      { name: "P-shape", tasks: "not-an-array" },
      admin,
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("validation_error");
    expect(body.error.details.fields[0].path).toBe("tasks");
    expect(body.error.details.fields[0].code).toBe("invalid_type");

    // Parent did not persist — the pre-flight check runs before the parent
    // write, so the TX never opened on a malformed nested key.
    const dbProjects = await selectMany(stack.db, projectTable);
    expect(dbProjects).toHaveLength(0);
  });

  test("explicit foreign key in sub-payload is rejected", async () => {
    // Security rail: a client trying to hang a nested task onto a different
    // project id by smuggling `projectId` into the sub-payload must be
    // refused up-front, not silently overwritten. The framework sets the
    // fk itself from the parent's new id.
    const res = await stack.http.write(
      "nested:write:project:create",
      {
        name: "P3",
        tasks: [{ title: "x", projectId: "00000000-0000-0000-0000-000000000001" }],
      },
      admin,
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.isSuccess).toBe(false);
    expect(body.error.code).toBe("validation_error");
    expect(body.error.details.fields[0].path).toMatch(/tasks\.0\.projectId/);

    // DB empty.
    const dbProjects = await selectMany(stack.db, projectTable);
    expect(dbProjects).toHaveLength(0);
  });
});
