// A parent delete with onDelete cascade or setNull removes or detaches its children through
// raw queries that bypass the executor, so a locked child has to block the parent delete in
// the delete lifecycle's cascade.

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import * as z from "zod";
import { createEventStoreExecutor, WritePurposes } from "../../db/event-store-executor.ts";
import { asRawClient } from "../../db/query.ts";
import { buildEntityTable } from "../../db/table-builder.ts";
import {
  createBooleanField,
  createEntity,
  createSystemUser,
  createTextField,
  defineEntityCreateHandler,
  defineEntityDeleteHandler,
  defineEntityDetailHandler,
  defineFeature,
} from "../../engine/index.ts";
import { TestUsers } from "../../seeding/seed-users.ts";

const projectEntity = createEntity({
  name: "project",
  table: "lock_cascade_projects",
  fields: { name: createTextField({ personal: false, reason: "test_fixture", required: true }) },
});

const taskEntity = createEntity({
  name: "task",
  table: "lock_cascade_tasks",
  fields: {
    title: createTextField({ personal: false, reason: "test_fixture", required: true }),
    projectId: createTextField({ personal: false, reason: "test_fixture" }),
    isDone: createBooleanField({ default: false }),
  },
  lockedWhen: { field: "isDone", eq: true },
});

const noteEntity = createEntity({
  name: "note",
  table: "lock_cascade_notes",
  fields: {
    text: createTextField({ personal: false, reason: "test_fixture", required: true }),
    projectId: createTextField({ personal: false, reason: "test_fixture" }),
    isFrozen: createBooleanField({ default: false }),
  },
  lockedWhen: { field: "isFrozen", eq: true },
});

const choreEntity = createEntity({
  name: "chore",
  table: "lock_cascade_chores",
  softDelete: true,
  fields: {
    title: createTextField({ personal: false, reason: "test_fixture", required: true }),
    projectId: createTextField({ personal: false, reason: "test_fixture" }),
    isDone: createBooleanField({ default: false }),
  },
  lockedWhen: { field: "isDone", eq: true },
});

const subtaskEntity = createEntity({
  name: "subtask",
  table: "lock_cascade_subtasks",
  fields: {
    title: createTextField({ personal: false, reason: "test_fixture", required: true }),
    taskId: createTextField({ personal: false, reason: "test_fixture" }),
    isDone: createBooleanField({ default: false }),
  },
  lockedWhen: { field: "isDone", eq: true },
});

const pinEntity = createEntity({
  name: "pin",
  table: "lock_cascade_pins",
  fields: {
    projectId: createTextField({ personal: false, reason: "test_fixture" }),
    noteId: createTextField({ personal: false, reason: "test_fixture" }),
    isPinned: createBooleanField({ default: false }),
  },
  lockedWhen: { field: "isPinned", eq: true },
});

const projectTable = buildEntityTable(projectEntity);

const ROLES = { access: { roles: ["Admin"] } } as const;
// A hard delete from a custom handler is irreversible and needs agent risk "high".
const IRREVERSIBLE = { ...ROLES, agent: { risk: "high" } } as const;

const cascadeFeature = defineFeature("lockcascade", (r) => {
  r.entity(projectEntity);
  r.entity(taskEntity);
  r.entity(noteEntity);
  r.entity(choreEntity);
  r.entity(subtaskEntity);
  r.entity(pinEntity);
  r.relation({
    entity: "task",
    name: "subtasks",
    type: "hasMany",
    target: "subtask",
    foreignKey: "taskId",
    onDelete: "cascade",
  });
  r.relation({
    entity: "project",
    name: "pins",
    type: "manyToMany",
    target: "note",
    through: { table: "pin", sourceKey: "projectId", targetKey: "noteId" },
    onDelete: "cascade",
  });
  r.relation({
    entity: "project",
    name: "tasks",
    type: "hasMany",
    target: "task",
    foreignKey: "projectId",
    onDelete: "cascade",
  });
  r.relation({
    entity: "project",
    name: "notes",
    type: "hasMany",
    target: "note",
    foreignKey: "projectId",
    onDelete: "setNull",
  });
  r.relation({
    entity: "project",
    name: "chores",
    type: "hasMany",
    target: "chore",
    foreignKey: "projectId",
    onDelete: "cascade",
  });

  const projectExecutor = createEventStoreExecutor(projectTable, projectEntity, {
    entityName: "project",
  });
  r.writeHandler({
    name: "project:system-delete",
    schema: z.object({ id: z.uuid(), purpose: z.enum(["none", "retention"]) }),
    handler: async (event, ctx) =>
      projectExecutor.delete(
        { id: event.payload.id },
        createSystemUser(event.user.tenantId),
        ctx.db,
        event.payload.purpose === "retention" ? { writePurpose: WritePurposes.retention } : {},
      ),
    ...IRREVERSIBLE,
  });
  r.writeHandler({
    name: "project:unlocking-delete",
    schema: z.object({ id: z.uuid() }),
    handler: async (event, ctx) =>
      projectExecutor.delete({ id: event.payload.id }, event.user, ctx.db, {
        unsafeSkipLockGuard: true,
      }),
    ...IRREVERSIBLE,
  });

  const choreExecutor = createEventStoreExecutor(buildEntityTable(choreEntity), choreEntity, {
    entityName: "chore",
  });
  r.writeHandler({
    name: "chore:unlocking-delete",
    schema: z.object({ id: z.uuid() }),
    handler: async (event, ctx) =>
      choreExecutor.delete({ id: event.payload.id }, event.user, ctx.db, {
        unsafeSkipLockGuard: true,
      }),
    ...ROLES,
  });

  for (const [name, entity] of [
    ["project", projectEntity],
    ["task", taskEntity],
    ["note", noteEntity],
    ["chore", choreEntity],
    ["subtask", subtaskEntity],
    ["pin", pinEntity],
  ] as const) {
    r.writeHandler(defineEntityCreateHandler(name, entity, ROLES));
    r.writeHandler(defineEntityDeleteHandler(name, entity, ROLES));
    r.queryHandler(defineEntityDetailHandler(name, entity, ROLES));
  }
});

let stack: TestStack;
const admin = TestUsers.admin;

beforeAll(async () => {
  stack = await setupTestStack({ features: [cascadeFeature], systemHooks: [] });
  await unsafeCreateEntityTable(stack.db, projectEntity, "project");
  await unsafeCreateEntityTable(stack.db, taskEntity, "task");
  await unsafeCreateEntityTable(stack.db, noteEntity, "note");
  await unsafeCreateEntityTable(stack.db, choreEntity, "chore");
  await unsafeCreateEntityTable(stack.db, subtaskEntity, "subtask");
  await unsafeCreateEntityTable(stack.db, pinEntity, "pin");
});

afterAll(async () => {
  await stack.cleanup();
});

afterEach(async () => {
  await asRawClient(stack.db).unsafe(
    `TRUNCATE kumiko_events, lock_cascade_projects, lock_cascade_tasks, lock_cascade_notes, lock_cascade_chores, lock_cascade_subtasks, lock_cascade_pins, kumiko_event_consumers RESTART IDENTITY CASCADE`,
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

async function createSubtask(taskId: string, isDone: boolean): Promise<string> {
  const created = await stack.http.writeOk<{ id: string }>(
    "lockcascade:write:subtask:create",
    { title: "s", taskId, isDone },
    admin,
  );
  return created.id;
}

async function createPin(projectId: string, noteId: string, isPinned: boolean): Promise<string> {
  const created = await stack.http.writeOk<{ id: string }>(
    "lockcascade:write:pin:create",
    { projectId, noteId, isPinned },
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

async function createChore(projectId: string, isDone: boolean): Promise<string> {
  const created = await stack.http.writeOk<{ id: string }>(
    "lockcascade:write:chore:create",
    { title: "c", projectId, isDone },
    admin,
  );
  return created.id;
}

async function countRows(table: string, id: string): Promise<number> {
  const rows = await asRawClient(stack.db).unsafe(`SELECT id FROM ${table} WHERE id = $1`, [id]);
  return rows.length;
}

async function expectParentLocked(
  projectId: string,
  ...hiddenIds: readonly string[]
): Promise<void> {
  const err = await stack.http.writeErr(
    "lockcascade:write:project:delete",
    { id: projectId, version: 1 },
    admin,
  );
  expect(err.httpStatus).toBe(409);
  expect(err.code).toBe("record_locked");
  expect(err.details).toMatchObject({ entityName: "project", entityId: projectId });
  for (const id of hiddenIds) {
    expect(JSON.stringify(err)).not.toContain(id);
  }
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

  test("a framework system delete with a writePurpose passes a locked cascade child", async () => {
    const projectId = await createProject();
    const taskId = await createTask(projectId, true);

    await stack.http.writeOk(
      "lockcascade:write:project:system-delete",
      { id: projectId, purpose: "retention" },
      admin,
    );

    expect(await countRows("lock_cascade_tasks", taskId)).toBe(0);
    expect(await countRows("lock_cascade_projects", projectId)).toBe(0);
  });

  test("a framework system delete without a writePurpose stays blocked by a locked child", async () => {
    const projectId = await createProject();
    const taskId = await createTask(projectId, true);

    const err = await stack.http.writeErr(
      "lockcascade:write:project:system-delete",
      { id: projectId, purpose: "none" },
      admin,
    );

    expect(err.code).toBe("record_locked");
    expect(await countRows("lock_cascade_tasks", taskId)).toBe(1);
  });

  test("an executor delete with unsafeSkipLockGuard passes a locked cascade child", async () => {
    const projectId = await createProject();
    const taskId = await createTask(projectId, true);

    await stack.http.writeOk(
      "lockcascade:write:project:unlocking-delete",
      { id: projectId },
      admin,
    );

    expect(await countRows("lock_cascade_tasks", taskId)).toBe(0);
  });

  test("a locked grandchild blocks the root delete and nothing changes", async () => {
    const projectId = await createProject();
    const taskId = await createTask(projectId, false);
    const subtaskId = await createSubtask(taskId, true);

    await expectParentLocked(projectId, taskId, subtaskId);

    expect(await countRows("lock_cascade_projects", projectId)).toBe(1);
    expect(await countRows("lock_cascade_tasks", taskId)).toBe(1);
    expect(await countRows("lock_cascade_subtasks", subtaskId)).toBe(1);
  });

  test("an executor delete with unsafeSkipLockGuard passes a locked grandchild", async () => {
    const projectId = await createProject();
    const taskId = await createTask(projectId, false);
    const subtaskId = await createSubtask(taskId, true);

    await stack.http.writeOk(
      "lockcascade:write:project:unlocking-delete",
      { id: projectId },
      admin,
    );

    expect(await countRows("lock_cascade_subtasks", subtaskId)).toBe(0);
    expect(await countRows("lock_cascade_tasks", taskId)).toBe(0);
  });

  test("a locked link row of a manyToMany cascade blocks the parent delete", async () => {
    const projectId = await createProject();
    const noteId = await createNote(projectId, false);
    const pinId = await createPin(projectId, noteId, true);

    await expectParentLocked(projectId, pinId);

    expect(await countRows("lock_cascade_pins", pinId)).toBe(1);
  });

  test("a soft-deleted locked child does not block the parent delete", async () => {
    const projectId = await createProject();
    const choreId = await createChore(projectId, true);
    await stack.http.writeOk("lockcascade:write:chore:unlocking-delete", { id: choreId }, admin);

    await stack.http.writeOk(
      "lockcascade:write:project:delete",
      { id: projectId, version: 1 },
      admin,
    );

    expect(await countRows("lock_cascade_projects", projectId)).toBe(0);
  });
});
