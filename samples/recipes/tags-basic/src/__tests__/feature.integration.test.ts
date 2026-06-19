// Tags Basic — integration test.
//
// Proves the host-agnostic tagging flow via the real dispatcher + DB:
//   1. a plain `note` is created (the note feature knows nothing about tags)
//   2. a tag is created in the catalog
//   3. the tag is assigned to the note by (entityType, entityId)
//   4. "tags of this note" and "notes with this tag" both read from
//      tag-assignment — read-layer composition, no JOIN, no column on `note`
//   5. removing the tag detaches it
//
// This is the smallest evidence that an entity needs zero tag-wiring.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  createTagsFeature,
  tagAssignmentEntity,
  tagEntity,
} from "@cosmicdrift/kumiko-bundled-features/tags";
import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";
import { createEventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { noteEntity, noteFeature } from "../feature";
import { type TagClient, tagFlow } from "../usage";

const admin = createTestUser({ roles: ["TenantAdmin"] });

// Adapt the test stack to the host-facing TagClient the docs embed uses.
const tagClient: TagClient = {
  write: <T>(type: string, payload: unknown) => stack.http.writeOk<T>(type, payload, admin),
  query: <T>(type: string, payload: unknown) => stack.http.queryOk<T>(type, payload, admin),
};
const tags = createTagsFeature();

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({ features: [tags, noteFeature] });
  await unsafeCreateEntityTable(stack.db, tagEntity);
  await unsafeCreateEntityTable(stack.db, tagAssignmentEntity);
  await unsafeCreateEntityTable(stack.db, noteEntity);
  await createEventsTable(stack.db);
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await asRawClient(stack.db).unsafe("DELETE FROM kumiko_events");
  await asRawClient(stack.db).unsafe("DELETE FROM read_sample_tags_notes");
  await asRawClient(stack.db).unsafe("DELETE FROM read_tags");
  await asRawClient(stack.db).unsafe("DELETE FROM read_tag_assignments");
});

async function createNote(id: string, title: string) {
  return stack.http.writeOk("note-management:write:note:create", { id, title }, admin);
}

async function createTag(name: string): Promise<string> {
  const tag = await stack.http.writeOk<{ id: string }>("tags:write:create-tag", { name }, admin);
  return tag.id;
}

async function assignTag(tagId: string, entityId: string) {
  return stack.http.writeOk(
    "tags:write:assign-tag",
    { tagId, entityType: "note", entityId },
    admin,
  );
}

// Read-layer composition: list assignments filtered on entityId → the note's
// tag ids. No JOIN, no tag column on `note`.
async function tagIdsOfNote(entityId: string): Promise<string[]> {
  const res = await stack.http.queryOk<{ rows: Array<{ tagId: string }> }>(
    "tags:query:tag-assignment:list",
    { filter: { field: "entityId", op: "eq", value: entityId } },
    admin,
  );
  return res.rows.map((r) => r.tagId);
}

describe("tags-basic recipe — assign + compose", () => {
  // Exercises the exact code embedded on the docs page (usage.ts → tagFlow).
  test("the documented tagFlow runs create → assign → compose → remove", async () => {
    const noteId = "55555555-5555-4000-8000-000000000005";
    await createNote(noteId, "Documented flow");

    const result = await tagFlow(tagClient, noteId);

    expect(result.tagsOfNote).toEqual([result.tagId]);
    expect(result.notesWithTag).toEqual([noteId]);
    // tagFlow detaches at the end → the note carries no tags afterwards.
    expect(await tagIdsOfNote(noteId)).toEqual([]);
  });

  test("a note carries a tag without any tag-column on the note", async () => {
    const noteId = "11111111-1111-4000-8000-000000000001";
    await createNote(noteId, "Quarterly review");
    const tagId = await createTag("important");

    await assignTag(tagId, noteId);

    expect(await tagIdsOfNote(noteId)).toEqual([tagId]);

    // The note row itself stays a plain { id, title } — no tag leakage.
    const notes = await stack.http.queryOk<{ rows: Array<Record<string, unknown>> }>(
      "note-management:query:note:list",
      {},
      admin,
    );
    const note = notes.rows.find((r) => r["id"] === noteId);
    expect(note?.["title"]).toBe("Quarterly review");
    expect(note).not.toHaveProperty("tagId");
  });

  test("one tag spans multiple notes (entities-with-tag direction)", async () => {
    await createNote("22222222-2222-4000-8000-000000000002", "Note A");
    await createNote("33333333-3333-4000-8000-000000000003", "Note B");
    const tagId = await createTag("project-x");

    await assignTag(tagId, "22222222-2222-4000-8000-000000000002");
    await assignTag(tagId, "33333333-3333-4000-8000-000000000003");

    const res = await stack.http.queryOk<{ rows: Array<{ entityId: string }> }>(
      "tags:query:tag-assignment:list",
      { filter: { field: "tagId", op: "eq", value: tagId } },
      admin,
    );
    expect(res.rows.map((r) => r.entityId).sort()).toEqual([
      "22222222-2222-4000-8000-000000000002",
      "33333333-3333-4000-8000-000000000003",
    ]);
  });

  test("removing the tag detaches it from the note", async () => {
    const noteId = "44444444-4444-4000-8000-000000000004";
    await createNote(noteId, "Temp");
    const tagId = await createTag("temp-tag");
    await assignTag(tagId, noteId);
    expect(await tagIdsOfNote(noteId)).toEqual([tagId]);

    await stack.http.writeOk(
      "tags:write:remove-tag",
      { tagId, entityType: "note", entityId: noteId },
      admin,
    );
    expect(await tagIdsOfNote(noteId)).toEqual([]);
  });
});
