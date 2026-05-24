// Provider-agnostic Test-DB: delegiert an createTestDb (postgres-js default).
// Set TEST_DB_PROVIDER=bun für Bun.SQL (experimentell — siehe db/bun-provider.ts).
// Setzt temporär DB_PROVIDER=TEST_DB_PROVIDER für createConnection.
//
// Typ ist bewusst `unknown` — Business-Code nutzt asRawClient().

import { createTestDb, type CreateTestDbOptions } from "../../stack/db";

export type BunTestDb = {
  db: unknown;
  client: unknown;
  dbName: string;
  cleanup: () => Promise<void>;
};

export async function createBunTestDb(baseUrl?: string): Promise<BunTestDb> {
  const provider = process.env["TEST_DB_PROVIDER"];
  if (provider) {
    // Temporär DB_PROVIDER überschreiben — createConnection liest DB_PROVIDER
    const saved = process.env["DB_PROVIDER"];
    process.env["DB_PROVIDER"] = provider;
    try {
      const opts: CreateTestDbOptions = baseUrl ? { baseUrl } : {};
      const td = await createTestDb(opts);
      return { db: td.db, client: td.client, dbName: td.dbName, cleanup: td.cleanup };
    } finally {
      if (saved) process.env["DB_PROVIDER"] = saved;
      else delete process.env["DB_PROVIDER"];
    }
  }
  // Default: createTestDb (postgres-js via DB_PROVIDER unset)
  const td = await createTestDb(baseUrl);
  return { db: td.db, client: td.client, dbName: td.dbName, cleanup: td.cleanup };
}
