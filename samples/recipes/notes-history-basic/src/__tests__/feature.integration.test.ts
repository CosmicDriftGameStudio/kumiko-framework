// Notes History Basic — integration test.
//
// Proves the host-agnostic note-history flow via the real dispatcher + DB:
//   1. a plain `task` is created (the task feature knows nothing about notes)
//   2. two notes are appended by (entityType, entityId)
//   3. "this task's note history" reads from note-entry — read-layer
//      composition, no JOIN, no column on `task`
//
// This is the smallest evidence that an entity needs zero notes-wiring.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  noteEntryEntity,
  notesHistoryFeature,
} from "@cosmicdrift/kumiko-bundled-features/notes-history";
import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";
import { createEventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { taskEntity, taskFeature } from "../feature";
import { type NotesClient, notesFlow } from "../usage";

const admin = createTestUser({ roles: ["TenantAdmin"] });

// Adapt the test stack to the host-facing NotesClient the docs embed uses.
const notesClient: NotesClient = {
  write: <T>(type: string, payload: unknown) => stack.http.writeOk<T>(type, payload, admin),
  query: <T>(type: string, payload: unknown) => stack.http.queryOk<T>(type, payload, admin),
};

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({ features: [notesHistoryFeature, taskFeature] });
  await unsafeCreateEntityTable(stack.db, noteEntryEntity);
  await unsafeCreateEntityTable(stack.db, taskEntity);
  await createEventsTable(stack.db);
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await asRawClient(stack.db).unsafe("DELETE FROM kumiko_events");
  await asRawClient(stack.db).unsafe("DELETE FROM read_sample_notes_history_tasks");
  await asRawClient(stack.db).unsafe("DELETE FROM read_note_entries");
});

async function createTask(id: string, title: string) {
  return stack.http.writeOk("task-management:write:task:create", { id, title }, admin);
}

describe("notes-history-basic recipe — append + compose", () => {
  // Exercises the exact code embedded on the docs page (usage.ts → notesFlow).
  test("the documented notesFlow appends two notes, newest first", async () => {
    const taskId = "55555555-5555-4000-8000-000000000005";
    await createTask(taskId, "Documented flow");

    const result = await notesFlow(notesClient, taskId);

    expect(result.entries).toHaveLength(2);
    expect(result.entries[0]?.body).toBe("Client confirmed the scope.");
    expect(result.entries[1]?.body).toBe("Kick-off call scheduled for Monday.");
    expect(result.entries[0]?.authorId).toBe(admin.id);
  });

  test("a task carries its note history without any notes-column on the task", async () => {
    const taskId = "11111111-1111-4000-8000-000000000001";
    await createTask(taskId, "Quarterly review");

    await notesClient.write("notes-history:write:add-note", {
      entityType: "task",
      entityId: taskId,
      body: "Reviewed budget.",
    });

    const tasks = await stack.http.queryOk<{ rows: Array<Record<string, unknown>> }>(
      "task-management:query:task:list",
      {},
      admin,
    );
    const task = tasks.rows.find((r) => r["id"] === taskId);
    expect(task?.["title"]).toBe("Quarterly review");
    expect(task).not.toHaveProperty("body");
  });

  test("notes are scoped per entity — a second task starts with an empty history", async () => {
    const taskA = "22222222-2222-4000-8000-000000000002";
    const taskB = "33333333-3333-4000-8000-000000000003";
    await createTask(taskA, "Task A");
    await createTask(taskB, "Task B");
    await notesClient.write("notes-history:write:add-note", {
      entityType: "task",
      entityId: taskA,
      body: "Only on A",
    });

    const ofB = await notesClient.query<{ rows: unknown[] }>(
      "notes-history:query:note-entry:list",
      {
        filter: { field: "entityId", op: "eq", value: taskB },
      },
    );
    expect(ofB.rows).toHaveLength(0);
  });
});
