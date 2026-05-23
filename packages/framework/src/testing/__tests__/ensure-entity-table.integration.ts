import { sql } from "@cosmicdrift/kumiko-framework/db";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { EntityDefinition } from "../../engine/types";
import {
  createTestDb,
  type TestDb,
  unsafeCreateEntityTable,
  unsafeEnsureEntityTable,
} from "../../stack";
import { asRawClient } from "../../bun-db/query";

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
    const rows = await asRawClient(db.db).unsafe(`SELECT to_regclass('public.ensure_entity_table_probe') IS NOT NULL AS exists`);
    expect(rows[0]?.exists).toBe(true);
  });

  test("ist beim zweiten Aufruf ein No-Op (returnt false, kein Fehler)", async () => {
    const created = await unsafeEnsureEntityTable(db.db, tenantEntity, "probe");
    expect(created).toBe(false);
  });

  test("unsafeCreateEntityTable bleibt strict — wirft bei existierender Tabelle", async () => {
    // Gleiche Entity zweimal via unsafeCreateEntityTable → postgres 42P07
    // (relation already exists). Drizzle wrappt den PG-Error in
    // DrizzleQueryError; der echte Code steckt in .cause. Sicherstellt,
    // dass unsafeEnsureEntityTable nicht versehentlich das strict-Verhalten
    // verändert.
    await expect(unsafeCreateEntityTable(db.db, tenantEntity, "probe")).rejects.toSatisfy((err) => {
      const cause = (err as { cause?: { code?: string } }).cause;
      return cause?.code === "42P07";
    });
  });
});
