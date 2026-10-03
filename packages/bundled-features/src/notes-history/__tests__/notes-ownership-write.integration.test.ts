// ownership.write on note-entry must gate add-note's create. The rule below
// lets a user write only notes whose host entityId is their own user id.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  createEntity,
  createTextField,
  defineFeature,
  from,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { expectErrorIncludes } from "@cosmicdrift/kumiko-framework/testing";
import { NotesHistoryHandlers } from "../constants.js";
import { noteEntryEntity, noteMentionEntity } from "../entity.js";
import { createNotesHistoryFeature } from "../feature.js";

const CONTACT_TABLE = "notes_ow_test_contacts";

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

const contactFixtureFeature = defineFeature("notes-ow-test-contact-fixture", (r) => {
  r.entity("contact", contactEntity);
});

const owner = createTestUser({ id: 90, roles: ["TenantMember"] });
const stranger = createTestUser({ id: 91, roles: ["TenantMember"] });

let stack: TestStack;

function noteCount(): Promise<number> {
  return asRawClient(stack.db)
    .unsafe<{ n: number }>(
      "SELECT count(*)::int AS n FROM read_note_entries WHERE entity_id = $1",
      [owner.id],
    )
    .then((rows) => rows[0]?.n ?? 0);
}

const notePayload = () => ({ entityType: "contact", entityId: owner.id, body: "hello" });

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      createNotesHistoryFeature({
        access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
        ownership: { write: { TenantMember: from("user:id", "entityId") } },
      }),
      contactFixtureFeature,
    ],
  });
  await unsafeCreateEntityTable(stack.db, noteEntryEntity);
  await unsafeCreateEntityTable(stack.db, noteMentionEntity);
  await unsafeCreateEntityTable(stack.db, contactEntity);
  await asRawClient(stack.db).unsafe(
    `INSERT INTO ${CONTACT_TABLE} (id, tenant_id, name) VALUES ($1, $2, 'own')`,
    [owner.id, owner.tenantId],
  );
});

afterAll(async () => {
  await stack.cleanup();
});

describe("notes-history — ownership.write gates add-note", () => {
  test("a caller outside the write rule cannot add a note", async () => {
    const err = await stack.http.writeErr(NotesHistoryHandlers.addNote, notePayload(), stranger);
    expectErrorIncludes(err, "ownership_denied");
    expect(await noteCount()).toBe(0);
  });

  test("a caller inside the write rule can add a note", async () => {
    await stack.http.writeOk(NotesHistoryHandlers.addNote, notePayload(), owner);
    expect(await noteCount()).toBe(1);
  });
});
