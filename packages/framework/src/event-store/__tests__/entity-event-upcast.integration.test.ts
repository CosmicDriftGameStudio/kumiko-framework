// Entity lifecycle events carry the entity's eventVersion and are upcast on
// rebuild through r.entity's eventMigrations.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { InMemoryKmsAdapter } from "../../crypto/in-memory-kms-adapter.js";
import {
  configurePiiSubjectKms,
  decryptPiiValueForSubject,
  PII_CIPHERTEXT_PREFIX,
} from "../../crypto/pii-field-encryption.js";
import type { DbTx } from "../../db/connection.js";
import { table as pgTable, text as pgText, uuid as pgUuid } from "../../db/dialect.js";
import { createEventStoreExecutor } from "../../db/event-store-executor.js";
import { insertOne, selectMany } from "../../db/query.js";
import { buildEntityTable } from "../../db/table-builder.js";
import { createTenantDb, type TenantDb } from "../../db/tenant-db.js";
import {
  createEntity,
  createRegistry,
  createTextField,
  defineFeature,
} from "../../engine/index.js";
import type { EntityEventMigration } from "../../engine/types/index.js";
import { createProjectionStateTable, rebuildProjection } from "../../pipeline/index.js";
import {
  createTestDb,
  type TestDb,
  TestUsers,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "../../stack/index.js";
import { resetPiiSubjectKmsForTests } from "../../testing/index.js";
import { loadAggregate } from "../index.js";

const textField = createTextField({ personal: false, reason: "test_fixture", required: false });

const legacyEntityV1 = createEntity({
  table: "read_legacy_notes",
  fields: { ref: textField },
});
const legacyTable = buildEntityTable("legacy-note", legacyEntityV1);

const noteRefsTable = pgTable("read_legacy_note_refs", {
  noteId: pgText("note_id").primaryKey(),
  tenantId: pgText("tenant_id").notNull(),
  refId: pgUuid("ref_id").notNull(),
});

function uuidFromLegacyRef(ref: string): string {
  return `00000000-0000-4000-8000-${ref.replace("legacy-", "").padStart(12, "0")}`;
}

const legacyRefToUuid: EntityEventMigration = {
  fromVersion: 1,
  toVersion: 2,
  transform: (fields) => {
    if (typeof fields["ref"] !== "string") return fields;
    const { ref, ...rest } = fields;
    return { ...rest, refId: uuidFromLegacyRef(String(ref)) };
  },
};

const legacyEntityV2 = createEntity({
  table: "read_legacy_notes",
  fields: { refId: textField },
  eventVersion: 2,
  eventMigrations: [legacyRefToUuid],
});

const refProjection = {
  name: "note-refs",
  source: "legacy-note",
  table: noteRefsTable,
  apply: {
    "legacy-note.created": async (
      event: { aggregateId: string; tenantId: string; payload: unknown },
      tx: unknown,
    ) => {
      const payload = event.payload as { refId?: string };
      await insertOne(tx as DbTx, noteRefsTable, {
        noteId: event.aggregateId,
        tenantId: event.tenantId,
        refId: payload.refId ?? null,
      });
    },
  },
};

const registryWithMigration = createRegistry([
  defineFeature("legacyv2", (r) => {
    r.entity("legacy-note", legacyEntityV2);
    r.projection(refProjection);
  }),
]);
const registryWithoutMigration = createRegistry([
  defineFeature("legacyv1", (r) => {
    r.entity("legacy-note", legacyEntityV1);
    r.projection(refProjection);
  }),
]);

const admin = TestUsers.admin;
let testDb: TestDb;
let tdb: TenantDb;
const executorV1 = createEventStoreExecutor(legacyTable, legacyEntityV1, {
  entityName: "legacy-note",
});
const executorV2 = createEventStoreExecutor(legacyTable, legacyEntityV2, {
  entityName: "legacy-note",
});

// A fresh database per test: rebuild replays every stored event, so isolation must not rely on raw deletes of kumiko_events.
beforeEach(async () => {
  testDb = await createTestDb();
  await unsafeCreateEntityTable(testDb.db, legacyEntityV1, "legacy-note");
  await createProjectionStateTable(testDb.db);
  await unsafePushTables(testDb.db, { legacyNoteRefs: noteRefsTable });
  tdb = createTenantDb(testDb.db, admin.tenantId);
});

afterEach(async () => {
  await testDb.cleanup();
});

describe("entity event versioning", () => {
  test("executor stamps the entity's eventVersion on lifecycle events", async () => {
    const created = await executorV2.create({ refId: "x" }, admin, tdb);
    expect(created.isSuccess).toBe(true);
    const id = created.isSuccess ? String(created.data["id"]) : "";
    const events = await loadAggregate(testDb.db, id, admin.tenantId);
    expect(events.map((e) => [e.type, e.eventVersion])).toEqual([["legacy-note.created", 2]]);
  });

  test("entities without eventVersion keep writing version 1", async () => {
    const created = await executorV1.create({ ref: "legacy-1" }, admin, tdb);
    const id = created.isSuccess ? String(created.data["id"]) : "";
    const events = await loadAggregate(testDb.db, id, admin.tenantId);
    expect(events.map((e) => e.eventVersion)).toEqual([1]);
  });

  test("rebuild upcasts v1 events written by the old definition", async () => {
    await executorV1.create({ ref: "legacy-7" }, admin, tdb);

    await rebuildProjection("legacyv2:projection:note-refs", {
      db: testDb.db,
      registry: registryWithMigration,
    });

    const rows = await selectMany(testDb.db, noteRefsTable, {});
    expect(rows.map((r) => r.refId)).toEqual([uuidFromLegacyRef("legacy-7")]);
  });

  test("rebuild without the migration fails on the old payload shape", async () => {
    await executorV1.create({ ref: "legacy-7" }, admin, tdb);

    await expect(
      rebuildProjection("legacyv1:projection:note-refs", {
        db: testDb.db,
        registry: registryWithoutMigration,
      }),
    ).rejects.toThrow();
  });
});

// Documented limit of eventMigrations: pii ciphertext is bound to its field name (AAD), so a
// transform that renames a pii field leaves a value that no longer decrypts under the new name.
describe("eventMigrations renaming a pii field", () => {
  const piiNoteV1 = createEntity({
    table: "read_pii_notes",
    fields: {
      ownerId: createTextField({ personal: "ref" }),
      name: createTextField({ personal: { of: "ownerId", whenAbsent: "tenant" }, find: "none" }),
    },
  });
  const piiNoteTable = buildEntityTable("pii-note", piiNoteV1);
  const renameNameToFullName: EntityEventMigration = {
    fromVersion: 1,
    toVersion: 2,
    transform: (fields) => {
      const { name, ...rest } = fields;
      return name === undefined ? rest : { ...rest, fullName: name };
    },
  };
  const piiNoteV2 = createEntity({
    table: "read_pii_notes",
    fields: {
      ownerId: createTextField({ personal: "ref" }),
      fullName: createTextField({
        personal: { of: "ownerId", whenAbsent: "tenant" },
        find: "none",
      }),
    },
    eventVersion: 2,
    eventMigrations: [renameNameToFullName],
  });
  const seenNamesTable = pgTable("read_pii_note_names", {
    noteId: pgText("note_id").primaryKey(),
    tenantId: pgText("tenant_id").notNull(),
    fullName: pgText("full_name"),
  });
  const registryRenamed = createRegistry([
    defineFeature("piiv2", (r) => {
      r.entity("pii-note", piiNoteV2);
      r.projection({
        name: "note-names",
        source: "pii-note",
        table: seenNamesTable,
        apply: {
          "pii-note.created": async (
            event: { aggregateId: string; tenantId: string; payload: unknown },
            tx: unknown,
          ) => {
            const payload = event.payload as { fullName?: string };
            await insertOne(tx as DbTx, seenNamesTable, {
              noteId: event.aggregateId,
              tenantId: event.tenantId,
              fullName: payload.fullName ?? null,
            });
          },
        },
      });
    }),
  ]);

  const kms = new InMemoryKmsAdapter();

  beforeEach(async () => {
    configurePiiSubjectKms(kms);
    await unsafeCreateEntityTable(testDb.db, piiNoteV1, "pii-note");
    await unsafePushTables(testDb.db, { seenNames: seenNamesTable });
  });

  afterEach(() => {
    resetPiiSubjectKmsForTests();
  });

  test("rebuild with an active KMS", async () => {
    const executor = createEventStoreExecutor(piiNoteTable, piiNoteV1, { entityName: "pii-note" });
    const created = await executor.create({ name: "Erika Mustermann" }, admin, tdb);
    expect(created.isSuccess).toBe(true);

    await rebuildProjection("piiv2:projection:note-names", {
      db: testDb.db,
      registry: registryRenamed,
    });

    // The rebuild completes and the renamed key carries the unchanged ciphertext...
    const [row] = await selectMany(testDb.db, seenNamesTable, {});
    const stored = row?.fullName ?? "";
    expect(stored.startsWith(PII_CIPHERTEXT_PREFIX)).toBe(true);
    // ...which is still bound to the old field name: it decrypts as "name", not as "fullName".
    const kmsContext = { requestId: "test" };
    expect(await decryptPiiValueForSubject(kms, stored, kmsContext, "name")).toBe(
      "Erika Mustermann",
    );
    await expect(decryptPiiValueForSubject(kms, stored, kmsContext, "fullName")).rejects.toThrow();
  });
});
