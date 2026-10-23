// Update payloads and preSave hook output may clear an optional stored field
// with `null`; a required field must keep rejecting it.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { resetTestTables } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import { eventsTable } from "../../event-store/index.ts";
import { TestUsers } from "../../seeding/seed-users.ts";
import { defineFeature } from "../define-feature.ts";
import {
  createBooleanField,
  createDateField,
  createEntity,
  createNumberField,
  createTextField,
  createTimestampField,
} from "../factories.ts";
import type { PreSaveHookFn } from "../types/index.ts";

const noteEntity = createEntity({
  table: "update_null_clear_notes",
  fields: {
    name: createTextField({ required: true, personal: false, reason: "test_fixture" }),
    endpoint: createTextField({ personal: false, reason: "test_fixture" }),
    isDone: createBooleanField({ default: undefined }),
    amount: createNumberField(),
    dueOn: createDateField(),
    startedAt: createTimestampField(),
    parentId: { type: "reference", entity: "note", labelField: "name" },
  },
});

let hookClearsEndpoint = false;
const clearEndpointWhenArmed: PreSaveHookFn = async (changes) =>
  hookClearsEndpoint ? { ...changes, endpoint: null } : changes;

const noteFeature = defineFeature("update-null-clear", (r) => {
  r.crud("note", noteEntity, {
    write: { access: { roles: ["User"] } },
    read: { access: { openToAll: { reason: "test handler callable by any signed-in test user" } } },
  });
  r.hook({ type: "preSave", target: "note:update", handler: clearEndpointWhenArmed });
});

const CREATE = "update-null-clear:write:note:create";
const UPDATE = "update-null-clear:write:note:update";
const DETAIL = "update-null-clear:query:note:detail";

type Created = { data: { data: { id: string; version: number } } };

describe("update clears optional fields with null", () => {
  let stack: TestStack;

  beforeAll(async () => {
    stack = await setupTestStack({ features: [noteFeature] });
    await unsafeCreateEntityTable(stack.db, noteEntity);
  });

  afterAll(async () => {
    await stack.cleanup();
  });

  beforeEach(async () => {
    hookClearsEndpoint = false;
    await resetTestTables(stack.db, [eventsTable, "update_null_clear_notes"]);
  });

  async function createNote(extra: Record<string, unknown> = {}): Promise<Created["data"]["data"]> {
    const res = await stack.http.write(
      CREATE,
      { name: "n", endpoint: "https://example.test", ...extra },
      TestUsers.user,
    );
    expect(res.status).toBe(200);
    return ((await res.json()) as Created).data.data;
  }

  async function readField(id: string, field: string): Promise<unknown> {
    const row = await stack.http.queryOk<Record<string, unknown>>(DETAIL, { id }, TestUsers.user);
    return row[field];
  }

  async function readEndpoint(id: string): Promise<unknown> {
    return readField(id, "endpoint");
  }

  test("direct update payload with null clears the field", async () => {
    const note = await createNote();
    const res = await stack.http.write(
      UPDATE,
      { id: note.id, version: note.version, changes: { endpoint: null } },
      TestUsers.user,
    );
    expect(res.status).toBe(200);
    expect(await readEndpoint(note.id)).toBeNull();
  });

  test("preSave hook returning null clears the field", async () => {
    const note = await createNote();
    hookClearsEndpoint = true;
    const res = await stack.http.write(
      UPDATE,
      { id: note.id, version: note.version, changes: { name: "renamed" } },
      TestUsers.user,
    );
    expect(res.status).toBe(200);
    expect(await readEndpoint(note.id)).toBeNull();
  });

  test.each([
    ["boolean", "isDone", true],
    ["number", "amount", 42],
    ["date", "dueOn", "2026-03-04"],
    ["timestamp", "startedAt", "2026-03-04T10:00:00.000Z"],
  ])("a %s field is cleared with null", async (_type, field, value) => {
    const note = await createNote({ [field]: value });
    expect(await readField(note.id, field)).not.toBeNull();

    const res = await stack.http.write(
      UPDATE,
      { id: note.id, version: note.version, changes: { [field]: null } },
      TestUsers.user,
    );

    expect(res.status).toBe(200);
    expect(await readField(note.id, field)).toBeNull();
  });

  test("a reference field is cleared with null", async () => {
    const parent = await createNote();
    const child = await createNote({ parentId: parent.id });
    expect(await readField(child.id, "parentId")).toBe(parent.id);

    const res = await stack.http.write(
      UPDATE,
      { id: child.id, version: child.version, changes: { parentId: null } },
      TestUsers.user,
    );

    expect(res.status).toBe(200);
    expect(await readField(child.id, "parentId")).toBeNull();
  });

  test("required field with null is rejected as a validation error", async () => {
    const note = await createNote();
    const err = await stack.http.writeErr(
      UPDATE,
      { id: note.id, version: note.version, changes: { name: null } },
      TestUsers.user,
    );
    expect([400, 422]).toContain(err.httpStatus);
    expect(err.code).toMatch(/validation|unprocessable/);
  });
});
