// Test-DB Factory: CREATE DATABASE → connect → createEventsTable.
// Provider-agnostic via createConnection (DB_PROVIDER env).
// postgres-js = default. DB_PROVIDER=bun = Bun.SQL (experimentell).

import { generateId } from "../utils";
import { createConnection } from "../db/api";
import { asRawClient } from "../db/query";
import { ensureTemporalPolyfill } from "../time/polyfill";

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

  // Admin-Verbindung für CREATE DATABASE — provider-agnostisch
  const admin = await createConnection(adminUrl, { maxConnections: 1 });
  const adminDb = asRawClient(admin.db);
  try {
    if (opts.persistent) {
      const existing = await adminDb.unsafe(
        `SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = $1) AS exists`,
        [dbName],
      );
      if (!(existing[0] as { exists?: boolean } | undefined)?.exists) {
        await adminDb.unsafe(`CREATE DATABASE "${dbName}"`);
      }
    } else {
      await adminDb.unsafe(`CREATE DATABASE "${dbName}"`);
    }
  } finally {
    await admin.close();
  }

  // Verbindung zur neuen DB
  const testUrl = url.replace(/\/[^/]+$/, `/${dbName}`);
  const conn = await createConnection(testUrl);

  // Events-Table — idempotent via IF NOT EXISTS
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
        const admin2Db = asRawClient(admin2.db);
        try {
          await admin2Db.unsafe(`DROP DATABASE IF EXISTS "${dbName}"`);
        } finally {
          await admin2.close();
        }
      }
    },
  };
}

export { requireEnv };
