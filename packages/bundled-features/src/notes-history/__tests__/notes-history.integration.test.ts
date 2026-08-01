// Full-stack integration for the notes-history bundle. Drives add-note → list
// through the real dispatcher + entity-projection + DB, proving the
// architecture end-to-end WITHOUT any host wiring (notes are host-agnostic —
// the host is just the entityType/entityId strings on the note-entry row):
//   - add-note projects into read_note_entries with insertedAt/insertedById
//     stamped by the framework (author + timestamp, base columns)
//   - a client-supplied authorId in the payload is ignored — the executor
//     always writes the authenticated caller's id
//   - read-layer composition: list filtered on entityId
//   - multi-tenant isolation
//   - append-only: only add-note and list are registered handlers

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";
import { createEventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { NotesHistoryHandlers, NotesHistoryQueries } from "../constants";
import { noteEntryEntity } from "../entity";
import { createNotesHistoryFeature } from "../feature";

const notesHistoryFeature = createNotesHistoryFeature();

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({ features: [notesHistoryFeature] });
  await unsafeCreateEntityTable(stack.db, noteEntryEntity);
  await createEventsTable(stack.db);
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await asRawClient(stack.db).unsafe("DELETE FROM kumiko_events");
  await asRawClient(stack.db).unsafe("DELETE FROM read_note_entries");
});

// Distinct ids (default createTestUser() shares TestUsers.admin.id) —
// authorId-attribution tests need two genuinely different users.
const admin = createTestUser({ id: 1, roles: ["TenantAdmin"] });
const member = createTestUser({ id: 2, roles: ["TenantMember"] });
const otherTenant = createTestUser({
  id: 10,
  roles: ["TenantAdmin"],
  tenantId: "00000000-0000-4000-8000-0000000000aa",
});

async function addNote(
  entityType: string,
  entityId: string,
  body: string,
  user = admin,
  extra: Record<string, unknown> = {},
): Promise<{ id: string }> {
  return stack.http.writeOk<{ id: string }>(
    NotesHistoryHandlers.addNote,
    { entityType, entityId, body, ...extra },
    user,
  );
}

async function listNotes(
  filter: { field: string; op: "eq"; value: unknown } | undefined,
  user = admin,
): Promise<Array<Record<string, unknown>>> {
  const res = await stack.http.queryOk<{ rows: Array<Record<string, unknown>> }>(
    NotesHistoryQueries.noteList,
    filter ? { filter } : {},
    user,
  );
  return res.rows;
}

describe("notes-history integration — add + list", () => {
  test("add-note lands in read_note_entries with author + timestamp stamped", async () => {
    const { id } = await addNote("contact", "contact-1", "Called about renewal", member);
    const rows = await listNotes({ field: "entityId", op: "eq", value: "contact-1" });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.["id"]).toBe(id);
    expect(rows[0]?.["body"]).toBe("Called about renewal");
    expect(rows[0]?.["authorId"]).toBe(member.id);
    expect(rows[0]?.["insertedAt"]).toBeTruthy();
  });

  test("a client-supplied authorId in the payload is ignored", async () => {
    await addNote("contact", "contact-2", "note", member, { authorId: admin.id });
    const rows = await listNotes({ field: "entityId", op: "eq", value: "contact-2" });
    // The write always attributes to the authenticated caller (member), never
    // to a value smuggled in through the payload — schema doesn't even accept
    // an authorId field, so this proves it's silently dropped, not honoured.
    expect(rows[0]?.["authorId"]).toBe(member.id);
  });

  test("multiple notes on the same entity accumulate — nothing overwrites", async () => {
    await addNote("contact", "contact-3", "first");
    await addNote("contact", "contact-3", "second");
    await addNote("contact", "contact-3", "third");
    const rows = await listNotes({ field: "entityId", op: "eq", value: "contact-3" });
    expect(rows.map((r) => r["body"]).sort()).toEqual(["first", "second", "third"]);
  });

  test("read-layer composition: filtering by entityId scopes to that entity only", async () => {
    await addNote("contact", "contact-4", "for four");
    await addNote("contact", "contact-5", "for five");
    const rows = await listNotes({ field: "entityId", op: "eq", value: "contact-4" });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.["body"]).toBe("for four");
  });

  test("empty body is rejected", async () => {
    const err = await stack.http.writeErr(
      NotesHistoryHandlers.addNote,
      { entityType: "contact", entityId: "contact-6", body: "  " },
      admin,
    );
    expect(err.httpStatus).toBe(400);
  });
});

describe("notes-history integration — multi-tenant isolation", () => {
  test("tenant B sees none of tenant A's notes", async () => {
    await addNote("contact", "contact-shared-id", "A's note", admin);

    expect(
      await listNotes({ field: "entityId", op: "eq", value: "contact-shared-id" }, otherTenant),
    ).toHaveLength(0);
    expect(
      await listNotes({ field: "entityId", op: "eq", value: "contact-shared-id" }, admin),
    ).toHaveLength(1);
  });
});
