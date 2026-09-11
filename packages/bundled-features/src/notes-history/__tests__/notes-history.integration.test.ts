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
//
// fw#2627 made add-note's parent-visibility check unconditional: entityType
// must name a registered entity, and the row must be visible to the caller.
// A minimal `contact` fixture entity (PASS_CLAUSE, no `access`) is mounted
// below and seeded with one row per id this file writes a note to — this
// file's own assertions are about note-entry behavior, not about parent
// ownership, so the fixture stays unrestricted on purpose.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";
import { createEntity, createTextField, defineFeature } from "@cosmicdrift/kumiko-framework/engine";
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

const CONTACT_TABLE = "notes_history_test_contacts";
const contactEntity = createEntity({
  table: CONTACT_TABLE,
  fields: {
    name: createTextField({
      required: true,
      maxLength: 64,
      personal: false,
      reason: "technical_reference",
    }),
  },
});
const contactFixtureFeature = defineFeature("notes-history-test-contact-fixture", (r) => {
  r.entity("contact", contactEntity);
});

let stack: TestStack;

// Distinct ids (default createTestUser() shares TestUsers.admin.id) —
// authorId-attribution tests need two genuinely different users.
const admin = createTestUser({ id: 1, roles: ["TenantAdmin"] });
const member = createTestUser({ id: 2, roles: ["TenantMember"] });
const otherTenant = createTestUser({
  id: 10,
  roles: ["TenantAdmin"],
  tenantId: "00000000-0000-4000-8000-0000000000aa",
});

const CONTACT_1 = "30000000-0000-4000-8000-000000000001";
const CONTACT_2 = "30000000-0000-4000-8000-000000000002";
const CONTACT_2B = "30000000-0000-4000-8000-00000000002b";
const CONTACT_3 = "30000000-0000-4000-8000-000000000003";
const CONTACT_4 = "30000000-0000-4000-8000-000000000004";
const CONTACT_5 = "30000000-0000-4000-8000-000000000005";
const CONTACT_6 = "30000000-0000-4000-8000-000000000006";
const CONTACT_SHARED = "30000000-0000-4000-8000-000000000007";

beforeAll(async () => {
  stack = await setupTestStack({ features: [notesHistoryFeature, contactFixtureFeature] });
  await unsafeCreateEntityTable(stack.db, noteEntryEntity);
  await unsafeCreateEntityTable(stack.db, contactEntity);
  await createEventsTable(stack.db);

  for (const id of [
    CONTACT_1,
    CONTACT_2,
    CONTACT_2B,
    CONTACT_3,
    CONTACT_4,
    CONTACT_5,
    CONTACT_6,
    CONTACT_SHARED,
  ]) {
    await asRawClient(stack.db).unsafe(
      `INSERT INTO ${CONTACT_TABLE} (id, tenant_id, name) VALUES ($1, $2, $3)`,
      [id, admin.tenantId, id],
    );
  }
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await asRawClient(stack.db).unsafe("DELETE FROM kumiko_events");
  await asRawClient(stack.db).unsafe("DELETE FROM read_note_entries");
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
    const { id } = await addNote("contact", CONTACT_1, "Called about renewal", member);
    const rows = await listNotes({ field: "entityId", op: "eq", value: CONTACT_1 });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.["id"]).toBe(id);
    expect(rows[0]?.["body"]).toBe("Called about renewal");
    expect(rows[0]?.["authorId"]).toBe(member.id);
    expect(rows[0]?.["insertedAt"]).toBeTruthy();
    // member is a synthetic SessionUser (createTestUser) with no backing
    // read_users row, so add-note's self-lookup finds nothing to stamp — see
    // add-note-author-name-kms.integration.test.ts for the seeded-user path
    // where a real displayName does land in authorName.
    expect(rows[0]?.["authorName"]).toBeNull();
  });

  test("a client-supplied authorId in the payload is ignored", async () => {
    await addNote("contact", CONTACT_2, "note", member, { authorId: admin.id });
    const rows = await listNotes({ field: "entityId", op: "eq", value: CONTACT_2 });
    // The write always attributes to the authenticated caller (member), never
    // to a value smuggled in through the payload — schema doesn't even accept
    // an authorId field, so this proves it's silently dropped, not honoured.
    expect(rows[0]?.["authorId"]).toBe(member.id);
  });

  test("a client-supplied authorName in the payload is ignored", async () => {
    await addNote("contact", CONTACT_2B, "note", member, { authorName: "Fake Display Name" });
    const rows = await listNotes({ field: "entityId", op: "eq", value: CONTACT_2B });
    // Same guard as authorId above: addNotePayloadSchema doesn't accept an
    // authorName field, so a smuggled value never survives to the write —
    // the name (once stamped) can only come from the caller's own session.
    expect(rows).toHaveLength(1);
    expect(rows[0]?.["authorName"]).toBeNull();
  });

  test("multiple notes on the same entity accumulate — nothing overwrites", async () => {
    await addNote("contact", CONTACT_3, "first");
    await addNote("contact", CONTACT_3, "second");
    await addNote("contact", CONTACT_3, "third");
    const rows = await listNotes({ field: "entityId", op: "eq", value: CONTACT_3 });
    expect(rows.map((r) => r["body"]).sort()).toEqual(["first", "second", "third"]);
  });

  test("read-layer composition: filtering by entityId scopes to that entity only", async () => {
    await addNote("contact", CONTACT_4, "for four");
    await addNote("contact", CONTACT_5, "for five");
    const rows = await listNotes({ field: "entityId", op: "eq", value: CONTACT_4 });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.["body"]).toBe("for four");
  });

  test("empty body is rejected", async () => {
    const err = await stack.http.writeErr(
      NotesHistoryHandlers.addNote,
      { entityType: "contact", entityId: CONTACT_6, body: "  " },
      admin,
    );
    expect(err.httpStatus).toBe(400);
  });
});

describe("notes-history integration — multi-tenant isolation", () => {
  test("tenant B sees none of tenant A's notes", async () => {
    await addNote("contact", CONTACT_SHARED, "A's note", admin);

    expect(
      await listNotes({ field: "entityId", op: "eq", value: CONTACT_SHARED }, otherTenant),
    ).toHaveLength(0);
    expect(
      await listNotes({ field: "entityId", op: "eq", value: CONTACT_SHARED }, admin),
    ).toHaveLength(1);
  });
});
