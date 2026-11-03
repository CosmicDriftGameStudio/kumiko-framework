// A hardDeleted parent takes the note bodies hanging on it along: note bodies are keyed per note, so
// the parent's own key never reaches them. Notes of a global parent sit in the tenant that wrote them.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  configurePiiSubjectKms,
  InMemoryKmsAdapter,
  PII_ERASED_SENTINEL,
} from "@cosmicdrift/kumiko-framework/crypto";
import { asRawClient, createTenantDb } from "@cosmicdrift/kumiko-framework/db";
import {
  createEntity,
  createTextField,
  defineFeature,
  SYSTEM_TENANT_ID,
} from "@cosmicdrift/kumiko-framework/engine";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { createTestUser } from "@cosmicdrift/kumiko-framework/seeding";
import { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import { resetPiiSubjectKmsForTests, resetTestTables } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import {
  createNotesHistoryFeature,
  NotesHistoryHandlers,
  noteEntryEntity,
  noteEntryExecutor,
  noteMentionEntity,
} from "../../notes-history/index.ts";
import { createDataRetentionFeature, tenantRetentionOverrideEntity } from "../feature.ts";
import { runRetentionCleanup } from "../run-retention-cleanup.ts";

const scopedEntity = createEntity({
  table: "read_notes_retention_scoped_docs",
  fields: {
    title: createTextField({ personal: false, reason: "test_fixture", required: true }),
  },
  retention: { keepFor: "30d", strategy: "hardDelete" },
});
const globalEntity = createEntity({
  table: "read_notes_retention_global_docs",
  tenancy: "global",
  systemStream: true,
  fields: {
    title: createTextField({ personal: false, reason: "test_fixture", required: true }),
  },
  retention: { keepFor: "30d", strategy: "hardDelete" },
});
const fixtureFeature = defineFeature("notes-retention-fixtures", (r) => {
  r.entity({ name: "notes-retention-scoped-doc", ...scopedEntity });
  r.entity({ name: "notes-retention-global-doc", ...globalEntity });
});

const writer = createTestUser({ id: 1, roles: ["TenantMember", "SystemAdmin"] });

let stack: TestStack;
let now: ReturnType<ReturnType<typeof getTemporal>["Now"]["instant"]>;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [createDataRetentionFeature(), createNotesHistoryFeature(), fixtureFeature],
  });
  for (const entity of [tenantRetentionOverrideEntity, scopedEntity, globalEntity]) {
    await unsafeCreateEntityTable(stack.db, entity);
  }
  await unsafeCreateEntityTable(stack.db, noteEntryEntity, "note-entry");
  await unsafeCreateEntityTable(stack.db, noteMentionEntity, "note-mention");
  now = getTemporal().Now.instant();
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await resetTestTables(stack.db, ["read_note_entries", "read_note_mentions", eventsTable]);
  configurePiiSubjectKms(new InMemoryKmsAdapter());
});

afterEach(() => {
  resetPiiSubjectKmsForTests();
});

async function seedDoc(
  table: string,
  tenantId: string,
  title: string,
  ageHours = 24 * 60,
): Promise<string> {
  const rows = (await asRawClient(stack.db).unsafe(
    `INSERT INTO ${table} (tenant_id, title, inserted_at) VALUES ($1, $2, $3::timestamptz) RETURNING id::text AS id`,
    [tenantId, title, now.subtract({ hours: ageHours }).toString()],
  )) as { id: string }[];
  const id = rows[0]?.id;
  if (!id) throw new Error("seedDoc: insert returned no id");
  return id;
}

async function addNote(entityType: string, entityId: string, body: string): Promise<string> {
  const note = await stack.http.writeOk<{ id: string }>(
    NotesHistoryHandlers.addNote,
    { entityType, entityId, body },
    writer,
  );
  return note.id;
}

async function bodyOf(noteId: string): Promise<unknown> {
  const tenantDb = createTenantDb({
    db: stack.db,
    tenantId: writer.tenantId,
    mode: "system",
    reason: "test inspects note rows across tenants after retention",
  });
  return (await noteEntryExecutor.detail({ id: noteId }, writer, tenantDb))?.["body"];
}

const runCleanup = (tenantId: string) =>
  runRetentionCleanup({
    db: stack.db,
    registry: stack.registry,
    tenantId: tenantId as typeof writer.tenantId,
    preloadedTenantPreset: null,
    now,
  });

describe("retention hardDelete cascades to the notes on the parent", () => {
  test("a tenant-scoped parent loses its note bodies, notes on other rows stay", async () => {
    const expired = await seedDoc("read_notes_retention_scoped_docs", writer.tenantId, "old");
    const live = await seedDoc("read_notes_retention_scoped_docs", writer.tenantId, "kept", 1);
    const onExpired = await addNote("notes-retention-scoped-doc", expired, "about the old doc");
    const onLive = await addNote("notes-retention-scoped-doc", live, "about the kept doc");

    expect((await runCleanup(writer.tenantId)).hardDeleted).toBe(1);

    expect(await bodyOf(onExpired)).toBe(PII_ERASED_SENTINEL);
    expect(await bodyOf(onLive)).toBe("about the kept doc");
  });

  test("a global parent swept in the system tenant takes notes written in a customer tenant", async () => {
    const expired = await seedDoc("read_notes_retention_global_docs", SYSTEM_TENANT_ID, "old");
    const note = await addNote("notes-retention-global-doc", expired, "operator note");

    expect((await runCleanup(SYSTEM_TENANT_ID)).hardDeleted).toBe(1);

    expect(await bodyOf(note)).toBe(PII_ERASED_SENTINEL);
  });
});
