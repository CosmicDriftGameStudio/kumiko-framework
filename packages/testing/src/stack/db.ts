// @runtime dev
// Test-DB Factory: CREATE DATABASE → connect → createEventsTable.

import { DEFAULT_OUTSIDE_TRANSACTION_POOL_MAX } from "@cosmicdrift/kumiko-framework/db";
import {
  createDatabase,
  createDbConnection,
  databaseExists,
  dropDatabaseIfExists,
} from "@cosmicdrift/kumiko-framework/internal/stack-support";
import { ensureTemporalPolyfill } from "@cosmicdrift/kumiko-framework/time";
import { generateId } from "@cosmicdrift/kumiko-framework/utils";
import type { DbConnection, PgListenClient } from "@cosmicdrift/kumiko-types/db-connection";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required env var: ${name}. Copy .env.example to .env and fill in values. Tests also need the test services (Postgres, Redis) running, e.g. "docker compose up -d".`,
    );
  }
  return value;
}

export const DEFAULT_TEST_DB_POOL_MAX = 10;

export type TestDb = {
  db: DbConnection;
  poolMax: number;
  outsideTransactionDb: DbConnection;
  client: PgListenClient;
  dbName: string;
  cleanup: () => Promise<void>;
};

export type CreateTestDbOptions = {
  readonly baseUrl?: string;
  readonly dbName?: string;
  readonly persistent?: boolean;
  readonly poolMax?: number;
  readonly outsideTransactionPoolMax?: number;
};

export async function createTestDb(arg?: string | CreateTestDbOptions): Promise<TestDb> {
  await ensureTemporalPolyfill();
  const opts: CreateTestDbOptions = typeof arg === "string" ? { baseUrl: arg } : (arg ?? {});
  const url = opts.baseUrl ?? requireEnv("TEST_DATABASE_URL");
  const dbName = opts.dbName ?? `kumiko_test_${generateId().slice(-8)}`;
  const adminUrl = url.replace(/\/[^/]+$/, "/postgres");

  const admin = createDbConnection({ url: adminUrl, maxConnections: 1 });
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
  const poolMax = opts.poolMax ?? DEFAULT_TEST_DB_POOL_MAX;
  const conn = createDbConnection({ url: testUrl, maxConnections: poolMax });
  const outsideConn = createDbConnection({
    url: testUrl,
    maxConnections: opts.outsideTransactionPoolMax ?? DEFAULT_OUTSIDE_TRANSACTION_POOL_MAX,
  });

  const { createEventsTable } = await import("@cosmicdrift/kumiko-framework/event-store");
  await createEventsTable(conn.db);

  return {
    db: conn.db,
    poolMax,
    outsideTransactionDb: outsideConn.db,
    client: conn.client,
    dbName,
    cleanup: async () => {
      await conn.close();
      await outsideConn.close();
      if (!opts.persistent) {
        const admin2 = createDbConnection({ url: adminUrl, maxConnections: 1 });
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
