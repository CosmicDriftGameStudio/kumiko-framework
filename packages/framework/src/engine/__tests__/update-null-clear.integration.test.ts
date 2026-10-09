// Update payloads and preSave hook output may clear an optional stored field
// with `null`; a required field must keep rejecting it.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { asRawClient } from "../../db/query.js";
import {
  setupTestStack,
  type TestStack,
  TestUsers,
  unsafeCreateEntityTable,
} from "../../stack/index.js";
import { defineFeature } from "../define-feature.js";
import { createEntity, createTextField } from "../factories.js";
import type { PreSaveHookFn } from "../types/index.js";

const noteEntity = createEntity({
  table: "update_null_clear_notes",
  fields: {
    name: createTextField({ required: true, personal: false, reason: "test_fixture" }),
    endpoint: createTextField({ personal: false, reason: "test_fixture" }),
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
  r.hook("preSave", "note:update", clearEndpointWhenArmed);
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
    await asRawClient(stack.db).unsafe("DELETE FROM kumiko_events");
    await asRawClient(stack.db).unsafe('DELETE FROM "update_null_clear_notes"');
  });

  async function createNote(): Promise<Created["data"]["data"]> {
    const res = await stack.http.write(
      CREATE,
      { name: "n", endpoint: "https://example.test" },
      TestUsers.user,
    );
    expect(res.status).toBe(200);
    return ((await res.json()) as Created).data.data;
  }

  async function readEndpoint(id: string): Promise<unknown> {
    const row = await stack.http.queryOk<Record<string, unknown>>(DETAIL, { id }, TestUsers.user);
    return row["endpoint"];
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

  test("required field with null is rejected", async () => {
    const note = await createNote();
    const res = await stack.http.write(
      UPDATE,
      { id: note.id, version: note.version, changes: { name: null } },
      TestUsers.user,
    );
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });
});
