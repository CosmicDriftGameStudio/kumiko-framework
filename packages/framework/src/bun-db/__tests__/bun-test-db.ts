// Provider-agnostic Test-DB: delegiert an createTestDb (postgres-js default).
// Welcher Provider tatsächlich genutzt wird steuert DB_PROVIDER env-var,
// gelesen in db/api.ts createConnection — global, einmalig zu Boot-Zeit.
//
// "Bun" im Namen ist historisch (Pattern-Discovery-Phase) — der Body ist
// provider-neutral. Aliase BunTestDb/createBunTestDb existieren damit
// die migrierten Test-Files importierbar bleiben ohne weitere Refactors.

import { createTestDb, type CreateTestDbOptions, type TestDb } from "../../stack/db";

export type { TestDb };
export type BunTestDb = TestDb;

export async function createBunTestDb(baseUrl?: string): Promise<TestDb> {
  const opts: CreateTestDbOptions = baseUrl ? { baseUrl } : {};
  return createTestDb(opts);
}

export { createTestDb };
