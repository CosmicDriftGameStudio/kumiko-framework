// A parent delete with onDelete cascade or setNull removes or detaches its children through
// raw queries that bypass the executor, so a locked child has to block the parent delete in
// the cascade hook. Runs with the cascade-delete system hook wired, which the plain
// record-lock suite does not have.

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { asRawClient } from "../../db/query-api.js";
import { buildEntityTable } from "../../db/table-builder.js";
import {
  createBooleanField,
  createEntity,
  createRegistry,
  createTextField,
  defineEntityCreateHandler,
  defineEntityDeleteHandler,
  defineEntityDetailHandler,
  defineFeature,
} from "../../engine/index.js";
import {
  setupTestStack,
  type TestStack,
  TestUsers,
  unsafeCreateEntityTable,
} from "../../stack/index.js";
import { createCascadeDeleteHook } from "../cascade-handler.js";

const projectEntity = createEntity({
  table: "lock_cascade_projects",
  fields: { name: createTextField({ personal: false, reason: "test_fixture", required: true }) },
});

const taskEntity = createEntity({
  table: "lock_cascade_tasks",
  fields: {
    title: createTextField({ personal: false, reason: "test_fixture", required: true }),
    projectId: createTextField({ personal: false, reason: "test_fixture" }),
    isDone: createBooleanField({ default: false }),
  },
  lockedWhen: { field: "isDone", eq: true },
});

const noteEntity = createEntity({
  table: "lock_cascade_notes",
  fields: {
    text: createTextField({ personal: false, reason: "test_fixture", required: true }),
    projectId: createTextField({ personal: false, reason: "test_fixture" }),
    isFrozen: createBooleanField({ default: false }),
  },
  lockedWhen: { field: "isFrozen", eq: true },
});

const ROLES = { access: { roles: ["Admin"] } } as const;

const cascadeFeature = defineFeature("lockcascade", (r) => {
  r.entity("project", projectEntity);
  r.entity("task", taskEntity);
  r.entity("note", noteEntity);
  r.relation("project", "tasks", {
    type: "hasMany",
    target: "task",
    foreignKey: "projectId",
    onDelete: "cascade",
  });
  r.relation("project", "notes", {
    type: "hasMany",
    target: "note",
    foreignKey: "projectId",
    onDelete: "setNull",
  });
  for (const [name, entity] of [
    ["project", projectEntity],
    ["task", taskEntity],
    ["note", noteEntity],
  ] as const) {
    r.writeHandler(defineEntityCreateHandler(name, entity, ROLES));
    r.writeHandler(defineEntityDeleteHandler(name, entity, ROLES));
    r.queryHandler(defineEntityDetailHandler(name, entity, ROLES));
  }
});

let stack: TestStack;
const admin = TestUsers.admin;

beforeAll(async () => {
  const hookRegistry = createRegistry([cascadeFeature]);
  const tables = new Map();
  tables.set("task", buildEntityTable("task", taskEntity));
  tables.set("note", buildEntityTable("note", noteEntity));
  const hook = createCascadeDeleteHook(hookRegistry, tables);
  stack = await setupTestStack({
    features: [cascadeFeature],
    systemHooks: [],
    lifecycleSystemHooks: { preDelete: [hook] },
  });
  await unsafeCreateEntityTable(stack.db, projectEntity, "project");
  await unsafeCreateEntityTable(stack.db, taskEntity, "task");
  await unsafeCreateEntityTable(stack.db, noteEntity, "note");
});

afterAll(async () => {
  await stack.cleanup();
});

afterEach(async () => {
  await asRawClient(stack.db).unsafe(
    `TRUNCATE kumiko_events, lock_cascade_projects, lock_cascade_tasks, lock_cascade_notes, kumiko_event_consumers RESTART IDENTITY CASCADE`,
  );
  await stack.eventDispatcher?.ensureRegistered();
});

async function createProject(): Promise<string> {
  const created = await stack.http.writeOk<{ id: string }>(
    "lockcascade:write:project:create",
    { name: "p" },
    admin,
  );
  return created.id;
}

async function createTask(projectId: string, isDone: boolean): Promise<string> {
  const created = await stack.http.writeOk<{ id: string }>(
    "lockcascade:write:task:create",
    { title: "t", projectId, isDone },
    admin,
  );
  return created.id;
}

async function createNote(projectId: string, isFrozen: boolean): Promise<string> {
  const created = await stack.http.writeOk<{ id: string }>(
    "lockcascade:write:note:create",
    { text: "n", projectId, isFrozen },
    admin,
  );
  return created.id;
}

async function expectParentLocked(projectId: string, childId: string): Promise<void> {
  const err = await stack.http.writeErr(
    "lockcascade:write:project:delete",
    { id: projectId, version: 1 },
    admin,
  );
  expect(err.httpStatus).toBe(409);
  expect(err.code).toBe("record_locked");
  expect(err.details).toMatchObject({ entityName: "project", entityId: projectId });
  expect(JSON.stringify(err)).not.toContain(childId);
}

describe("lockedWhen children block a parent delete", () => {
  test("a locked onDelete cascade child blocks the parent delete and nothing changes", async () => {
    const projectId = await createProject();
    const taskId = await createTask(projectId, true);

    await expectParentLocked(projectId, taskId);

    await stack.http.queryOk("lockcascade:query:project:detail", { id: projectId }, admin);
    const task = await stack.http.queryOk<{ projectId: string }>(
      "lockcascade:query:task:detail",
      { id: taskId },
      admin,
    );
    expect(task.projectId).toBe(projectId);
  });

  test("a locked onDelete setNull child blocks the parent delete and keeps its foreign key", async () => {
    const projectId = await createProject();
    const noteId = await createNote(projectId, true);

    await expectParentLocked(projectId, noteId);

    await stack.http.queryOk("lockcascade:query:project:detail", { id: projectId }, admin);
    const note = await stack.http.queryOk<{ projectId: string | null }>(
      "lockcascade:query:note:detail",
      { id: noteId },
      admin,
    );
    expect(note.projectId).toBe(projectId);
  });

  test("an unlocked cascade child is deleted with the parent", async () => {
    const projectId = await createProject();
    const taskId = await createTask(projectId, false);

    await stack.http.writeOk(
      "lockcascade:write:project:delete",
      { id: projectId, version: 1 },
      admin,
    );

    const rows = await asRawClient(stack.db).unsafe(
      "SELECT id FROM lock_cascade_tasks WHERE id = $1",
      [taskId],
    );
    expect(rows).toHaveLength(0);
  });

  test("an unlocked setNull child is detached from the deleted parent", async () => {
    const projectId = await createProject();
    const noteId = await createNote(projectId, false);

    await stack.http.writeOk(
      "lockcascade:write:project:delete",
      { id: projectId, version: 1 },
      admin,
    );

    const rows = await asRawClient(stack.db).unsafe<{ project_id: string | null }>(
      "SELECT project_id FROM lock_cascade_notes WHERE id = $1",
      [noteId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.project_id).toBeNull();
  });
});
