// Provider-agnostic Test-DB: delegiert an createTestDb (postgres-js default).
// Set TEST_DB_PROVIDER=bun für Bun.SQL (experimentell — siehe db/bun-provider.ts).
//
// Der exportierte createTestDb ENTHÄLT TEST_DB_PROVIDER-Logik (superset von stack/db.ts).
// Alias-Exporte erlauben Import aus diesem Modul mit kanonischen Namen.

import { createTestDb as createPgTestDb, type CreateTestDbOptions } from "../../stack/db";

export type BunTestDb = {
  db: unknown;
  client: unknown;
  dbName: string;
  cleanup: () => Promise<void>;
};

export type TestDb = BunTestDb;

export async function createBunTestDb(baseUrl?: string): Promise<BunTestDb> {
  const provider = process.env["TEST_DB_PROVIDER"];
  if (provider) {
    const saved = process.env["DB_PROVIDER"];
    process.env["DB_PROVIDER"] = provider;
    try {
      const opts: CreateTestDbOptions = baseUrl ? { baseUrl } : {};
      const td = await createPgTestDb(opts);
      return { db: td.db, client: td.client, dbName: td.dbName, cleanup: td.cleanup };
    } finally {
      if (saved) process.env["DB_PROVIDER"] = saved;
      else delete process.env["DB_PROVIDER"];
    }
  }
  const td = await createPgTestDb(baseUrl);
  return { db: td.db, client: td.client, dbName: td.dbName, cleanup: td.cleanup };
}

export const createTestDb = createBunTestDb;
