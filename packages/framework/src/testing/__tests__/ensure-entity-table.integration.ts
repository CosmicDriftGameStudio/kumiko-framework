import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { EntityDefinition } from "../../engine/types";
import { createEntityTable, createTestDb, ensureEntityTable, type TestDb } from "../../stack";

// ensureEntityTable ist die idempotente Variante von createEntityTable —
// existiert wegen des dev-server-Boot-Pfads (persistente DB, Table von
// letztem Run). createEntityTable bleibt strict, damit Tests ein
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

describe("ensureEntityTable", () => {
  test("legt die Tabelle beim ersten Aufruf an (returnt true)", async () => {
    const created = await ensureEntityTable(db.db, tenantEntity, "probe");
    expect(created).toBe(true);
    const rows = await db.db.execute<{ exists: boolean }>(
      sql`SELECT to_regclass('public.ensure_entity_table_probe') IS NOT NULL AS exists`,
    );
    expect(rows[0]?.exists).toBe(true);
  });

  test("ist beim zweiten Aufruf ein No-Op (returnt false, kein Fehler)", async () => {
    const created = await ensureEntityTable(db.db, tenantEntity, "probe");
    expect(created).toBe(false);
  });

  test("createEntityTable bleibt strict — wirft bei existierender Tabelle", async () => {
    // Gleiche Entity zweimal via createEntityTable → postgres 42P07
    // (relation already exists). Drizzle wrappt den PG-Error in
    // DrizzleQueryError; der echte Code steckt in .cause. Sicherstellt,
    // dass ensureEntityTable nicht versehentlich das strict-Verhalten
    // verändert.
    await expect(createEntityTable(db.db, tenantEntity, "probe")).rejects.toSatisfy((err) => {
      const cause = (err as { cause?: { code?: string } }).cause;
      return cause?.code === "42P07";
    });
  });
});
