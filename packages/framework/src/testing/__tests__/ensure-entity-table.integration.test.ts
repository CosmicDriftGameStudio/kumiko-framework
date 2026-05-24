import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { asRawClient } from "../../db/query";
import type { EntityDefinition } from "../../engine/types";
import {
  createTestDb,
  type TestDb,
  unsafeCreateEntityTable,
  unsafeEnsureEntityTable,
} from "../../stack";

// unsafeEnsureEntityTable ist die idempotente Variante von unsafeCreateEntityTable —
// existiert wegen des dev-server-Boot-Pfads (persistente DB, Table von
// letztem Run). unsafeCreateEntityTable bleibt strict, damit Tests ein
// falsches Schema nicht stillschweigend akzeptieren.

const tenantEntity: EntityDefinition = {
  fields: {
    title: { type: "text", required: true },
  },
  table: "ensure_entity_table_probe",
} as unknown as EntityDefinition;

let db: TestDb;

beforeAll(async () => {
  db = await createTestDb();
});

afterAll(async () => {
  await db.cleanup();
});

describe("unsafeEnsureEntityTable", () => {
  test("legt die Tabelle beim ersten Aufruf an (returnt true)", async () => {
    const created = await unsafeEnsureEntityTable(db.db, tenantEntity, "probe");
    expect(created).toBe(true);
    const rows = await asRawClient(db.db).unsafe<{ exists: boolean }>(
      `SELECT to_regclass('public.ensure_entity_table_probe') IS NOT NULL AS exists`,
    );
    expect(rows[0]?.exists).toBe(true);
  });

  test("ist beim zweiten Aufruf ein No-Op (returnt false, kein Fehler)", async () => {
    const created = await unsafeEnsureEntityTable(db.db, tenantEntity, "probe");
    expect(created).toBe(false);
  });

  test("unsafeCreateEntityTable ist idempotent — zweiter Push wirft nicht (CREATE IF NOT EXISTS)", async () => {
    // CREATE TABLE IF NOT EXISTS — idempotent by design.
    await expect(unsafeCreateEntityTable(db.db, tenantEntity, "probe")).resolves.toBeUndefined();
  });
});
