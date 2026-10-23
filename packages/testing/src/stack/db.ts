// @runtime dev
// Test-DB Factory: CREATE DATABASE → connect → createEventsTable.

import { DEFAULT_OUTSIDE_TRANSACTION_POOL_MAX } from "@cosmicdrift/kumiko-framework/db";
import {
  acquireSessionAdvisoryLock,
  createApplicationRole,
  createDatabase,
  createDbConnection,
  databaseExists,
  dropDatabaseIfExists,
  listDatabaseNamesWithPrefix,
  renameDatabase,
  transferDatabaseOwnership,
  transferPublicSchemaOwnership,
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

// Non-superuser without BYPASSRLS: the only login that makes row-level-security policies bite in tests.
export const TEST_APPLICATION_ROLE = "kumiko_app";

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
  /** Own the database as the non-bypass application role and enforce row-level security on the pools. */
  readonly applicationRole?: boolean;
};

// Set by the integration runner for one run; templates named after it are dropped when the run ends.
export const TEST_DB_TEMPLATE_RUN_ENV = "KUMIKO_TEST_DB_TEMPLATE_RUN";

// Inside the kumiko_test_ namespace, so clean-test-dbs also sweeps templates of killed runs.
export function testDbTemplatePrefix(runId: string): string {
  return `kumiko_test_tpl_${runId}_`;
}

export function adminUrlOf(url: string): string {
  return url.replace(/\/[^/]+$/, "/postgres");
}

function databaseUrlOf(url: string, dbName: string): string {
  return url.replace(/\/[^/]+$/, `/${dbName}`);
}

// DDL takes no bind params, so the password is read from the configured URL instead of a literal.
function applicationRoleUrlOf(url: string, dbName: string): string {
  const parsed = new URL(databaseUrlOf(url, dbName));
  parsed.username = TEST_APPLICATION_ROLE;
  parsed.password = new URL(url).password;
  return parsed.toString();
}

async function ensureApplicationRole(admin: DbConnection, url: string): Promise<void> {
  await createApplicationRole(
    admin,
    TEST_APPLICATION_ROLE,
    decodeURIComponent(new URL(url).password),
  );
}

// Admin connections below run as superuser for CREATE/DROP DATABASE and never open a tenant scope: "off" is explicit.
async function adoptPersistentDatabase(
  admin: DbConnection,
  url: string,
  dbName: string,
): Promise<void> {
  await transferDatabaseOwnership(admin, dbName, TEST_APPLICATION_ROLE);
  const owner = createDbConnection({
    url: databaseUrlOf(url, dbName),
    maxConnections: 1,
    rowLevelSecurity: "off", // superuser ownership transfer, no tenant scope
  });
  try {
    await transferPublicSchemaOwnership(owner.db, TEST_APPLICATION_ROLE);
  } finally {
    await owner.close();
  }
}

type ProvisionArgs = {
  readonly url: string;
  readonly dbName: string;
  readonly opts: CreateTestDbOptions;
  readonly applicationRole: boolean;
  readonly owner: string | undefined;
};

async function provisionDatabase(
  admin: DbConnection,
  { url, dbName, opts, applicationRole, owner }: ProvisionArgs,
): Promise<void> {
  const existing = opts.persistent === true && (await databaseExists(admin, dbName));
  if (existing && applicationRole) await adoptPersistentDatabase(admin, url, dbName);
  if (!existing) {
    const template = opts.persistent === true ? undefined : opts.templateDbName;
    await createDatabase(admin, dbName, template, owner);
  }
}

export async function createTestDb(arg?: string | CreateTestDbOptions): Promise<TestDb> {
  await ensureTemporalPolyfill();
  const opts: CreateTestDbOptions = typeof arg === "string" ? { baseUrl: arg } : (arg ?? {});
  const url = opts.baseUrl ?? requireEnv("TEST_DATABASE_URL");
  const dbName = opts.dbName ?? `kumiko_test_${generateId().slice(-8)}`;
  const adminUrl = adminUrlOf(url);

  const applicationRole = opts.applicationRole === true;
  const owner = applicationRole ? TEST_APPLICATION_ROLE : undefined;
  const admin = createDbConnection({ url: adminUrl, maxConnections: 1, rowLevelSecurity: "off" });
  try {
    if (applicationRole) await ensureApplicationRole(admin.db, url);
    await provisionDatabase(admin.db, { url, dbName, opts, applicationRole, owner });
  } finally {
    await admin.close();
  }

  const testUrl = applicationRole ? applicationRoleUrlOf(url, dbName) : databaseUrlOf(url, dbName);
  const rowLevelSecurity = applicationRole ? "on" : "off";
  const poolMax = opts.poolMax ?? DEFAULT_TEST_DB_POOL_MAX;
  const conn = createDbConnection({ url: testUrl, maxConnections: poolMax, rowLevelSecurity });
  const outsideConn = createDbConnection({
    url: testUrl,
    rowLevelSecurity,
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
    client: conn.listenClient,
    dbName,
    cleanup: async () => {
      await conn.close();
      await outsideConn.close();
      if (!opts.persistent) {
        const admin2 = createDbConnection({
          url: adminUrl,
          maxConnections: 1,
          rowLevelSecurity: "off",
        });
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
  options: { readonly applicationRole?: boolean } = {},
): Promise<void> {
  const known = testDbTemplates.get(templateDbName);
  if (known) return known;
  const pending = buildTestDbTemplate(templateDbName, buildSchema, options);
  testDbTemplates.set(templateDbName, pending);
  pending.catch(() => testDbTemplates.delete(templateDbName));
  return pending;
}

export async function buildTestDbTemplate(
  templateDbName: string,
  buildSchema: (db: DbConnection) => Promise<void>,
  options: { readonly applicationRole?: boolean } = {},
): Promise<void> {
  const applicationRole = options.applicationRole === true;
  const url = requireEnv("TEST_DATABASE_URL");
  // One connection, so the session that takes the advisory lock is the one closed below.
  const admin = createDbConnection({
    url: adminUrlOf(url),
    maxConnections: 1,
    rowLevelSecurity: "off",
  });
  try {
    await acquireSessionAdvisoryLock(admin.db, templateDbName);
    // skip: another worker of this run already built it while we waited on the lock
    if (await databaseExists(admin.db, templateDbName)) return;
    // Built under a side name and renamed once complete, so a clone never sees a half-built schema.
    const buildDbName = `${templateDbName}_build`;
    await dropDatabaseIfExists(admin.db, buildDbName);
    if (applicationRole) await ensureApplicationRole(admin.db, url);
    await createDatabase(
      admin.db,
      buildDbName,
      undefined,
      applicationRole ? TEST_APPLICATION_ROLE : undefined,
    );
    const conn = createDbConnection(
      applicationRole
        ? { url: applicationRoleUrlOf(url, buildDbName), maxConnections: 1, rowLevelSecurity: "on" }
        : { url: databaseUrlOf(url, buildDbName), maxConnections: 1, rowLevelSecurity: "off" },
    );
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
  const admin = createDbConnection({
    url: adminUrlOf(baseUrl),
    maxConnections: 1,
    rowLevelSecurity: "off",
  });
  try {
    for (const name of await listDatabaseNamesWithPrefix(admin.db, testDbTemplatePrefix(runId))) {
      await dropDatabaseIfExists(admin.db, name);
    }
  } finally {
    await admin.close();
  }
}

export { requireEnv };
