// add-note's authorName stamping (see add-note.write.ts): the handler reads
// the caller's own read_users row (ctx.db.raw, tenant-agnostic self-lookup —
// same pattern as user-data-rights/handlers/cancel-deletion.write.ts) and
// decrypts displayName before writing it as authorName. Pinned with a real
// KMS adapter so the round-trip is proven end-to-end, not assumed from a
// no-op-encrypt test env — a later refactor that silently reintroduces the
// raw UUID or gets stuck on the placeholder would fail this.
//
// fw#2627 made add-note's parent-visibility check unconditional, so a
// minimal `contact` fixture entity (PASS_CLAUSE) is mounted below and seeded
// with the one row this file writes a note to — orthogonal to what this file
// actually tests (authorName stamping).

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { asRawClient, selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  configurePiiSubjectKms,
  InMemoryKmsAdapter,
  isPiiCiphertext,
} from "@cosmicdrift/kumiko-framework/crypto";
import {
  createEntity,
  createTextField,
  defineFeature,
  type SessionUser,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  setupTestStack,
  type TestStack,
  testTenantId,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { resetPiiSubjectKmsForTests } from "@cosmicdrift/kumiko-framework/testing";
import { userEntity, userTable } from "../../user/schema/user";
import { seedUser } from "../../user/seeding";
import { NotesHistoryHandlers, NotesHistoryQueries } from "../constants";
import { noteEntryEntity } from "../entity";
import { createNotesHistoryFeature } from "../feature";

const notesHistoryFeature = createNotesHistoryFeature();
const tenantId = testTenantId(1);

const CONTACT_TABLE = "notes_kms_test_contacts";
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
const contactFixtureFeature = defineFeature("notes-kms-test-contact-fixture", (r) => {
  r.entity("contact", contactEntity);
});
const CONTACT_KMS_AUTHOR = "40000000-0000-4000-8000-000000000001";

let stack: TestStack;

function memberUser(userId: string): SessionUser {
  return { id: userId, tenantId, roles: ["TenantMember"] };
}

beforeAll(async () => {
  stack = await setupTestStack({ features: [notesHistoryFeature, contactFixtureFeature] });
  await unsafeCreateEntityTable(stack.db, noteEntryEntity);
  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafeCreateEntityTable(stack.db, contactEntity);
  await asRawClient(stack.db).unsafe(
    `INSERT INTO ${CONTACT_TABLE} (id, tenant_id, name) VALUES ($1, $2, $3)`,
    [CONTACT_KMS_AUTHOR, tenantId, CONTACT_KMS_AUTHOR],
  );
});

afterAll(async () => {
  await stack.cleanup();
});

afterEach(() => {
  resetPiiSubjectKmsForTests();
});

describe("add-note — authorName stamped from the writer's own user row", () => {
  test("with an active KMS, the written note carries the writer's decrypted displayName — not the UUID, not the placeholder", async () => {
    // KMS active BEFORE the seed — seedUser runs through the executor, so
    // the row reflects the encrypted prod state.
    configurePiiSubjectKms(new InMemoryKmsAdapter());
    const { id: userId } = await seedUser(stack.db, {
      email: "notes-author@example.com",
      displayName: "Priya Natarajan",
      emailVerified: true,
    });

    // Prove the row is actually ciphertext at rest — otherwise a no-op
    // encrypt path would make this test pass while proving nothing.
    const rawUserRows = await selectMany<{ displayName: unknown }>(stack.db, userTable, {
      id: userId,
    });
    expect(isPiiCiphertext(rawUserRows[0]?.displayName)).toBe(true);

    const { id: noteId } = await stack.http.writeOk<{ id: string }>(
      NotesHistoryHandlers.addNote,
      { entityType: "contact", entityId: CONTACT_KMS_AUTHOR, body: "Called back." },
      memberUser(userId),
    );

    const { rows } = await stack.http.queryOk<{ rows: Array<Record<string, unknown>> }>(
      NotesHistoryQueries.noteList,
      { filter: { field: "entityId", op: "eq", value: CONTACT_KMS_AUTHOR } },
      memberUser(userId),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.["id"]).toBe(noteId);
    expect(rows[0]?.["authorName"]).toBe("Priya Natarajan");
    expect(rows[0]?.["authorName"]).not.toBe(userId);
    expect(rows[0]?.["authorName"]).not.toBe("Unknown author");
  });
});
