// Test-DB Factory: CREATE DATABASE → connect → createEventsTable.
// Provider-agnostic via createConnection (DB_PROVIDER env).
// postgres-js = default. DB_PROVIDER=bun = Bun.SQL (experimentell).

import { createConnection } from "../db/api";
import {
  createDatabase,
  databaseExists,
  dropDatabaseIfExists,
} from "../db/queries/test-stack";
import { ensureTemporalPolyfill } from "../time/polyfill";
import { generateId } from "../utils";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required env var: ${name}. Copy .env.example to .env and fill in values.`,
    );
  }
  return value;
}

export type TestDb = {
  db: unknown;
  client: unknown;
  dbName: string;
  cleanup: () => Promise<void>;
};

export type CreateTestDbOptions = {
  readonly baseUrl?: string;
  readonly dbName?: string;
  readonly persistent?: boolean;
};

/**
 * Provider-agnostische Test-DB. createConnection liest DB_PROVIDER.
 * Für Bun.SQL: DB_PROVIDER=bun setzen (experimentell — siehe db/bun-provider.ts).
 */
export async function createTestDb(arg?: string | CreateTestDbOptions): Promise<TestDb> {
  await ensureTemporalPolyfill();
  const opts: CreateTestDbOptions = typeof arg === "string" ? { baseUrl: arg } : (arg ?? {});
  const url = opts.baseUrl ?? requireEnv("TEST_DATABASE_URL");
  const dbName = opts.dbName ?? `kumiko_test_${generateId().slice(-8)}`;
  const adminUrl = url.replace(/\/[^/]+$/, "/postgres");

  const admin = await createConnection(adminUrl, { maxConnections: 1 });
  try {
    if (opts.persistent) {
      if (!(await databaseExists(admin.db, dbName))) {
        await createDatabase(admin.db, dbName);
      }
    } else {
      await createDatabase(admin.db, dbName);
    }
  } finally {
    await admin.close();
  }

  const testUrl = url.replace(/\/[^/]+$/, `/${dbName}`);
  const conn = await createConnection(testUrl);

  const { createEventsTable } = await import("../event-store");
  await createEventsTable(conn.db);

  return {
    db: conn.db,
    client: conn.client,
    dbName,
    cleanup: async () => {
      await conn.close();
      if (!opts.persistent) {
        const admin2 = await createConnection(adminUrl, { maxConnections: 1 });
        try {
          await dropDatabaseIfExists(admin2.db, dbName);
        } finally {
          await admin2.close();
        }
      }
    },
  };
}

export { requireEnv };
