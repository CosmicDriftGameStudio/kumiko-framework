// @runtime dev
// Test-DB Factory: CREATE DATABASE → connect → createEventsTable.

import { DEFAULT_OUTSIDE_TRANSACTION_POOL_MAX } from "@cosmicdrift/kumiko-framework/db";
import {
  acquireSessionAdvisoryLock,
  createDatabase,
  createDbConnection,
  databaseExists,
  dropDatabaseIfExists,
  listDatabaseNamesWithPrefix,
  renameDatabase,
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
  /** Clone this already-migrated database instead of starting empty. */
  readonly templateDbName?: string;
};

// Set by the integration runner for one run; templates named after it are dropped when the run ends.
export const TEST_DB_TEMPLATE_RUN_ENV = "KUMIKO_TEST_DB_TEMPLATE_RUN";

// Inside the kumiko_test_ namespace, so clean-test-dbs also sweeps templates of killed runs.
export function testDbTemplatePrefix(runId: string): string {
  return `kumiko_test_tpl_${runId}_`;
}

function adminUrlOf(url: string): string {
  return url.replace(/\/[^/]+$/, "/postgres");
}

function databaseUrlOf(url: string, dbName: string): string {
  return url.replace(/\/[^/]+$/, `/${dbName}`);
}

export async function createTestDb(arg?: string | CreateTestDbOptions): Promise<TestDb> {
  await ensureTemporalPolyfill();
  const opts: CreateTestDbOptions = typeof arg === "string" ? { baseUrl: arg } : (arg ?? {});
  const url = opts.baseUrl ?? requireEnv("TEST_DATABASE_URL");
  const dbName = opts.dbName ?? `kumiko_test_${generateId().slice(-8)}`;
  const adminUrl = adminUrlOf(url);

  const admin = createDbConnection({ url: adminUrl, maxConnections: 1 });
  try {
    if (opts.persistent) {
      if (!(await databaseExists(admin.db, dbName))) {
        await createDatabase(admin.db, dbName);
      }
    } else {
      await createDatabase(admin.db, dbName, opts.templateDbName);
    }
  } finally {
    await admin.close();
  }

  const testUrl = databaseUrlOf(url, dbName);
  const poolMax = opts.poolMax ?? DEFAULT_TEST_DB_POOL_MAX;
  const conn = createDbConnection({ url: testUrl, maxConnections: poolMax });
  const outsideConn = createDbConnection({
    url: testUrl,
    maxConnections: opts.outsideTransactionPoolMax ?? DEFAULT_OUTSIDE_TRANSACTION_POOL_MAX,
  });

  if (opts.templateDbName === undefined) {
    const { createEventsTable } = await import("@cosmicdrift/kumiko-framework/event-store");
    await createEventsTable(conn.db);
  }

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

const testDbTemplates = new Map<string, Promise<void>>();

// One build per template and process; other workers of the run wait on the
// advisory lock and reuse the finished database.
export function ensureTestDbTemplate(
  templateDbName: string,
  buildSchema: (db: DbConnection) => Promise<void>,
): Promise<void> {
  const known = testDbTemplates.get(templateDbName);
  if (known) return known;
  const pending = buildTestDbTemplate(templateDbName, buildSchema);
  testDbTemplates.set(templateDbName, pending);
  pending.catch(() => testDbTemplates.delete(templateDbName));
  return pending;
}

async function buildTestDbTemplate(
  templateDbName: string,
  buildSchema: (db: DbConnection) => Promise<void>,
): Promise<void> {
  const url = requireEnv("TEST_DATABASE_URL");
  // One connection, so the session that takes the advisory lock is the one closed below.
  const admin = createDbConnection({ url: adminUrlOf(url), maxConnections: 1 });
  try {
    await acquireSessionAdvisoryLock(admin.db, templateDbName);
    // skip: another worker of this run already built it while we waited on the lock
    if (await databaseExists(admin.db, templateDbName)) return;
    // Built under a side name and renamed once complete, so a clone never sees a half-built schema.
    const buildDbName = `${templateDbName}_build`;
    await dropDatabaseIfExists(admin.db, buildDbName);
    await createDatabase(admin.db, buildDbName);
    const conn = createDbConnection({ url: databaseUrlOf(url, buildDbName), maxConnections: 1 });
    try {
      await buildSchema(conn.db);
    } finally {
      await conn.close();
    }
    await renameDatabase(admin.db, buildDbName, templateDbName);
  } finally {
    await admin.close();
  }
}

export async function dropTestDbTemplates(baseUrl: string, runId: string): Promise<void> {
  const admin = createDbConnection({ url: adminUrlOf(baseUrl), maxConnections: 1 });
  try {
    for (const name of await listDatabaseNamesWithPrefix(admin.db, testDbTemplatePrefix(runId))) {
      await dropDatabaseIfExists(admin.db, name);
    }
  } finally {
    await admin.close();
  }
}

export { requireEnv };
