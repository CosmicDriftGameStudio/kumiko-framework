// Migration-Safety-Test: `ALTER TABLE … SET NOT NULL` schlägt fehl wenn
// die Spalte vor der Migration NULL-Werte enthält.
//
// Hintergrund: Der A-Fix (required → notNull in fieldToColumns) erzeugt
// für bestehende Apps eine drift-fix-Migration mit `SET NOT NULL` auf
// jedem required-Feld. Das ist sicher gegen FRISCHE DBs (keine Daten
// drin), aber gefährlich gegen Prod-DBs in denen historisch NULL-Werte
// reingerutscht sein könnten — die Migration kracht beim apply mit:
//
//   ERROR: column "<name>" of relation "<table>" contains null values
//   STATE: 23502 (not_null_violation)
//
// Dieser Test simuliert genau das. Schreibt eine Tabelle mit nullable
// `key`, fügt eine Zeile mit NULL ein, versucht dann SET NOT NULL —
// erwartet den Postgres-Error. Operations-Hinweis: vor dem deploy einer
// solchen Migration eine Sanity-Query auf NULL-Counts in den betroffenen
// Spalten laufen, oder DB drop'pen wenn der State Demo-State ist.

import { sql } from "@cosmicdrift/kumiko-framework/db";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { createTestDb, type TestDb } from "../../stack";
import { asRawClient } from "../../bun-db/query";

let testDb: TestDb;

beforeAll(async () => {
  testDb = await createTestDb();
});

afterAll(async () => {
  await testDb.cleanup();
});

beforeEach(async () => {
  await asRawClient(testDb.db).unsafe(`DROP TABLE IF EXISTS migration_safety_test`);
});

describe("ALTER TABLE SET NOT NULL — Daten-Sicherheits-Verhalten", () => {
  test("SET NOT NULL kracht wenn die Spalte NULL-Zeilen enthält", async () => {
    await asRawClient(testDb.db).unsafe(`
      CREATE TABLE migration_safety_test (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        key text
      )
    `);
    // NULL-Zeile einschleusen — simuliert prod state vor dem Drift-Fix.
    await asRawClient(testDb.db).unsafe(`INSERT INTO migration_safety_test (key) VALUES (NULL)`);

    let caught: unknown;
    try {
      await asRawClient(testDb.db).unsafe(`ALTER TABLE migration_safety_test ALTER COLUMN key SET NOT NULL`);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    // Drizzle wrapped den PG-Error in einer DrizzleQueryError. Der echte
    // not_null_violation steckt in `.cause` als postgres-js Error mit
    // `.code === "23502"` und einem deutschsprachigen oder englischen
    // `.message`. Wir prüfen pragmatisch beide Pfade.
    const cause = (caught as { cause?: unknown }).cause;
    const causeCode = (cause as { code?: string } | undefined)?.code;
    expect(causeCode).toBe("23502");
  });

  test("SET NOT NULL läuft sauber durch wenn alle Zeilen Werte haben", async () => {
    await asRawClient(testDb.db).unsafe(`
      CREATE TABLE migration_safety_test (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        key text
      )
    `);
    await asRawClient(testDb.db).unsafe(`INSERT INTO migration_safety_test (key) VALUES ('foo')`);
    await asRawClient(testDb.db).unsafe(`INSERT INTO migration_safety_test (key) VALUES ('bar')`);

    // Sollte ohne Throw durchlaufen.
    await asRawClient(testDb.db).unsafe(`ALTER TABLE migration_safety_test ALTER COLUMN key SET NOT NULL`);

    // Verifizieren: zukünftige NULL-Inserts werden jetzt blockiert.
    let caught: unknown;
    try {
      await asRawClient(testDb.db).unsafe(`INSERT INTO migration_safety_test (key) VALUES (NULL)`);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
  });

  test("SET NOT NULL auf leerer Tabelle ist trivial sicher", async () => {
    // Frisch erstellt, keine Zeilen — der Fall in dem `migrate apply` nach
    // einem DB-drop läuft. Dieser Pfad muss IMMER grün sein, sonst wäre
    // jeder Greenfield-Deploy kaputt.
    await asRawClient(testDb.db).unsafe(`
      CREATE TABLE migration_safety_test (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        key text
      )
    `);
    await asRawClient(testDb.db).unsafe(`ALTER TABLE migration_safety_test ALTER COLUMN key SET NOT NULL`);

    // Beweis: information_schema zeigt die Spalte jetzt als NOT NULL.
    const rows = await asRawClient(testDb.db).unsafe(`SELECT is_nullable FROM information_schema.columns WHERE table_name = 'migration_safety_test' AND column_name = 'key'`);
    expect(rows[0]?.is_nullable).toBe("NO");
  });
});
