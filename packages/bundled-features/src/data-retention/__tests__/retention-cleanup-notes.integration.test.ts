// A hardDeleted parent takes the note bodies hanging on it along: note bodies are keyed per note, so
// the parent's own key never reaches them. Notes of a global parent sit in the tenant that wrote them.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  configurePiiSubjectKms,
  InMemoryKmsAdapter,
  PII_ERASED_SENTINEL,
} from "@cosmicdrift/kumiko-framework/crypto";
import { buildEntityTable } from "@cosmicdrift/kumiko-framework/db";
import {
  createEntity,
  createTextField,
  defineFeature,
  SYSTEM_TENANT_ID,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  eventsTable,
  runSeedWritesAt,
  SEED_MODE_ENV,
} from "@cosmicdrift/kumiko-framework/event-store";
import { createTenantDb } from "@cosmicdrift/kumiko-framework/internal/row-level-security";
import { createTestUser } from "@cosmicdrift/kumiko-framework/seeding";
import { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import {
  resetPiiSubjectKmsForTests,
  resetTestTables,
  seedRowViaEventStore,
  withEnv,
} from "@cosmicdrift/kumiko-testing/helpers";
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
  name: "notes-retention-scoped-doc",
  table: "read_notes_retention_scoped_docs",
  fields: {
    title: createTextField({ personal: false, reason: "test_fixture", required: true }),
  },
  retention: { keepFor: "30d", strategy: "hardDelete" },
});
const globalEntity = createEntity({
  name: "notes-retention-global-doc",
  table: "read_notes_retention_global_docs",
  tenancy: "global",
  systemStream: true,
  fields: {
    title: createTextField({ personal: false, reason: "test_fixture", required: true }),
  },
  retention: { keepFor: "30d", strategy: "hardDelete" },
});
const fixtureFeature = defineFeature("notes-retention-fixtures", (r) => {
  r.entity(scopedEntity);
  r.entity(globalEntity);
});

const writer = createTestUser({ id: 1, roles: ["TenantMember", "SystemAdmin"] });

let stack: TestStack;
let now: ReturnType<ReturnType<typeof getTemporal>["Now"]["instant"]>;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      createDataRetentionFeature(),
      createNotesHistoryFeature({
        parents: ["notes-retention-scoped-doc", "notes-retention-global-doc"],
      }),
      fixtureFeature,
    ],
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

// The create event is back-dated, so the row's inserted_at lands before the cutoff. A global
// entity takes no tenantId; the helper writes it in the system tenant.
async function seedDoc(
  entity: Parameters<typeof buildEntityTable>[0],
  tenantId: string | undefined,
  title: string,
  ageHours = 24 * 60,
): Promise<string> {
  const id = crypto.randomUUID();
  await withEnv({ [SEED_MODE_ENV]: "1" }, () =>
    runSeedWritesAt(now.subtract({ hours: ageHours }), () =>
      seedRowViaEventStore(stack.db, buildEntityTable(entity), {
        id,
        title,
        ...(tenantId !== undefined && { tenantId }),
      }),
    ),
  );
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
    const expired = await seedDoc(scopedEntity, writer.tenantId, "old");
    const live = await seedDoc(scopedEntity, writer.tenantId, "kept", 1);
    const onExpired = await addNote("notes-retention-scoped-doc", expired, "about the old doc");
    const onLive = await addNote("notes-retention-scoped-doc", live, "about the kept doc");

    expect((await runCleanup(writer.tenantId)).hardDeleted).toBe(1);

    expect(await bodyOf(onExpired)).toBe(PII_ERASED_SENTINEL);
    expect(await bodyOf(onLive)).toBe("about the kept doc");
  });

  test("a global parent swept in the system tenant takes notes written in a customer tenant", async () => {
    const expired = await seedDoc(globalEntity, undefined, "old");
    const note = await addNote("notes-retention-global-doc", expired, "operator note");

    expect((await runCleanup(SYSTEM_TENANT_ID)).hardDeleted).toBe(1);

    expect(await bodyOf(note)).toBe(PII_ERASED_SENTINEL);
  });
});
