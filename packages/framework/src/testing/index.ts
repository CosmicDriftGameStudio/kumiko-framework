import { getTableName, sql } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { tableExists } from "../db/schema-inspection";
import { buildDrizzleTable, toTableName } from "../db/table-builder";
import { generateId } from "../utils";
import type { TestStack } from "./test-stack";

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
  db: ReturnType<typeof drizzle>;
  client: ReturnType<typeof postgres>;
  dbName: string;
  cleanup: () => Promise<void>;
};

export type CreateTestDbOptions = {
  /** Override TEST_DATABASE_URL. Rare — mostly for tests that want a
   *  non-default Postgres (e.g. a read-replica probe). */
  readonly baseUrl?: string;
  /** Use a specific DB name instead of the default
   *  `kumiko_test_<8chars>`. Combined with `persistent: true`, lets a
   *  dev server keep state across restarts. Must be a legal Postgres
   *  identifier — the caller is responsible for matching the usual
   *  [a-z_0-9]+ shape. */
  readonly dbName?: string;
  /** When true, cleanup() is a no-op and the DB survives. Also
   *  changes CREATE DATABASE to IF-NOT-EXISTS semantics so restarts
   *  reuse the same storage. Default false (test contract: fresh DB
   *  per call, dropped on cleanup). */
  readonly persistent?: boolean;
};

/**
 * Accepts a baseUrl string (legacy shorthand used by most tests) OR an
 * options object. The string form is kept because thousands of tests
 * call `createTestDb()` with no args; only dev-server and niche tests
 * need the options form.
 */
export async function createTestDb(arg?: string | CreateTestDbOptions): Promise<TestDb> {
  const opts: CreateTestDbOptions = typeof arg === "string" ? { baseUrl: arg } : (arg ?? {});
  const url = opts.baseUrl ?? requireEnv("TEST_DATABASE_URL");
  // slice(-8) — the last 8 hex chars of a UUIDv7 are pure random (the
  // front 48 bits are a timestamp, which would collide across workers
  // that start within the same millisecond).
  const dbName = opts.dbName ?? `kumiko_test_${generateId().slice(-8)}`;
  const adminUrl = url.replace(/\/[^/]+$/, "/postgres");

  const adminClient = postgres(adminUrl);
  try {
    if (opts.persistent) {
      // Postgres has no CREATE DATABASE IF NOT EXISTS; emulate with a
      // catalog probe so restarts are idempotent.
      const existing = await adminClient<{ exists: boolean }[]>`
        SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = ${dbName}) AS exists
      `;
      if (!existing[0]?.exists) {
        await adminClient.unsafe(`CREATE DATABASE "${dbName}"`);
      }
    } else {
      await adminClient.unsafe(`CREATE DATABASE "${dbName}"`);
    }
  } finally {
    await adminClient.end();
  }

  const testUrl = url.replace(/\/[^/]+$/, `/${dbName}`);
  const client = postgres(testUrl);
  const db = drizzle(client);

  // Every ES-entity writes events; auto-create the events table so tests that
  // go straight to createTestDb (not setupTestStack) also work out of the box.
  // In persistent mode this is idempotent: createEventsTable emits IF NOT
  // EXISTS so a second boot is a no-op.
  const { createEventsTable } = await import("../event-store");
  await createEventsTable(db);

  return {
    db,
    client,
    dbName,
    cleanup: async () => {
      await client.end();
      // Persistent mode: dev-server owns the DB lifecycle — don't drop
      // on process exit. `yarn kumiko clean-test-dbs` is the escape
      // hatch when you really want to start over.
      if (!opts.persistent) {
        const admin = postgres(adminUrl);
        try {
          await admin.unsafe(`DROP DATABASE IF EXISTS "${dbName}"`);
        } finally {
          await admin.end();
        }
      }
    },
  };
}

// --- Redis ---

export type TestRedis = {
  redis: import("ioredis").default;
  /** Delete every key this test created (prefix-scoped). Replaces the old
   *  `redis.flushdb()` — that wiped other parallel tests' BullMQ state. */
  flushNamespace: () => Promise<void>;
  cleanup: () => Promise<void>;
};

export async function createTestRedis(): Promise<TestRedis> {
  const Redis = (await import("ioredis")).default;
  const redisUrl = requireEnv("REDIS_URL");
  // Every test gets a per-file key prefix on a shared DB (no DB-pool-of-15
  // round-robin). Collisions at birthday-paradox rates are gone — the
  // prefix space is unbounded. See Track B.3 in docs/plans/tests-refactor.
  const prefix = `kt:${generateId().slice(-8)}:`;
  const redis = new Redis(redisUrl, { keyPrefix: prefix });

  async function flushNamespace(): Promise<void> {
    // Open a prefix-less client for the scan — ioredis' keyPrefix is applied
    // per-command but SCAN's returned keys are full names, so managing the
    // del set with the prefix already on the connection is error-prone.
    const raw = new Redis(redisUrl);
    try {
      const stream = raw.scanStream({ match: `${prefix}*`, count: 500 });
      const keys: string[] = [];
      for await (const batch of stream) keys.push(...batch);
      if (keys.length > 0) await raw.del(...keys);
    } finally {
      raw.disconnect();
    }
  }

  return {
    redis,
    flushNamespace,
    cleanup: async () => {
      await flushNamespace();
      redis.disconnect();
    },
  };
}

// --- Shared Test Utilities ---

export { rolesOf } from "./access-assertions";
export { expectError, expectSuccess } from "./assertions";
export {
  type E2EGeneratorOptions,
  type E2ETestSpec,
  type EditFillOp,
  generateE2ESpec,
  generateZodFixture,
} from "./e2e-generator";
export { createEventCollector, type EventCollector } from "./event-collector";
export { expectErrorIncludes } from "./expect-error";
export {
  createTestUser,
  sharedItemEntity,
  sharedItemTable,
  sharedUserEntity,
  sharedUserTable,
  sharedWidgetEntity,
  sharedWidgetTable,
  TestUsers,
  testTenantId,
  testUserId,
} from "./fixtures";
export { bridgeStub } from "./handler-context";
export {
  getSetCookieRaw,
  getSetCookies,
  getSetCookieValue,
  type ParsedSetCookie,
} from "./http-cookies";
export { createLateBoundHolder, type LateBoundHolder } from "./late-bound";
export {
  createMutableMasterKeyProvider,
  type MutableMasterKeyProvider,
} from "./mutable-master-key-provider";
export {
  createRecordingProvider,
  type RecordingProvider,
} from "./observability-recorder";
export type { RequestHelper } from "./request-helper";
export { createRequestHelper } from "./request-helper";
export { setupTestStack, type TestStack, type TestStackOptions } from "./test-stack";
export { sleep } from "./utils";
export { waitFor } from "./wait-for";

// --- Helpers ---

/**
 * Syncs a Drizzle table to the database via drizzle-kit migration.
 * No manual SQL — Drizzle generates CREATE/ALTER TABLE statements.
 * Strict: raises a postgres `relation already exists` (42P07) error if
 * the table is already there. Use `ensureEntityTable` for idempotent
 * boot paths.
 */
export async function createEntityTable(
  db: ReturnType<typeof drizzle>,
  entity: import("../engine/types").EntityDefinition,
  entityName?: string,
): Promise<void> {
  const table = buildDrizzleTable(entityName ?? "entity", entity);
  await pushTables(db, { [entityName ?? "entity"]: table });
}

/**
 * Idempotent variant of `createEntityTable`: checks whether the entity's
 * table already exists and skips creation if so. Schema-drift is *not*
 * detected — if the table is there but has the wrong columns, that's
 * the caller's problem (the dev-server contract is "drop the DB by
 * hand when you change the schema"). Tests should use
 * `createEntityTable` instead, since they rely on fresh DBs.
 */
export async function ensureEntityTable(
  db: ReturnType<typeof drizzle>,
  entity: import("../engine/types").EntityDefinition,
  entityName?: string,
): Promise<boolean> {
  const resolvedName = entity.table ?? toTableName(entityName ?? "entity");
  if (await tableExists(db, `public.${resolvedName}`)) return false;
  await createEntityTable(db, entity, entityName);
  return true;
}

/**
 * Pushes Drizzle table definitions to the database.
 * Uses drizzle-kit's generateDrizzleJson + generateMigration to produce SQL,
 * then executes it. Same SQL that `drizzle-kit push` would generate.
 *
 * @param prevTables - Previous table definitions (for ALTER TABLE scenarios).
 *                     If omitted, assumes empty DB (CREATE TABLE).
 */
export async function pushTables(
  db: ReturnType<typeof drizzle>,
  tables: Record<string, unknown>,
  prevTables?: Record<string, unknown>,
): Promise<void> {
  const { generateDrizzleJson, generateMigration } = await import("drizzle-kit/api");
  const prevJson = generateDrizzleJson(prevTables ?? {});
  const targetJson = generateDrizzleJson(tables);
  const statements = await generateMigration(prevJson, targetJson);
  for (const stmt of statements) {
    await db.execute(sql.raw(stmt));
  }
}

/**
 * Wipes event store + framework-state + the given feature read-models in
 * one TRUNCATE, then re-registers the event-consumer state rows. Used in
 * test beforeEach-hooks to return the stack to a clean slate without
 * rebuilding it.
 *
 * Fixed list of framework tables (kumiko_events, kumiko_event_consumers,
 * kumiko_archived_streams, kumiko_snapshots, kumiko_projections) is always
 * included — any event-sourced test setup needs those cleared. The
 * `extraTables` arg covers the feature's own read-model tables that would
 * otherwise accumulate rows across tests.
 *
 * Accepts either a Drizzle PgTable (for locally-defined tables: getTableName
 * extracts the SQL name) or a plain string (for SQL names whose Drizzle
 * reference lives in another module and importing it for the TRUNCATE
 * alone would be overkill). Both round-trip to the same TRUNCATE list.
 *
 * Pre-existing code duplicates this block 30+ times, each with its own
 * list of extras. The helper collapses that to a one-liner per test and
 * lets a future change to the framework-table set (e.g. adding a new
 * consumer-state table) ripple through without touching every suite.
 */
export async function resetEventStore(
  stack: TestStack,
  extraTables: readonly (PgTable | string)[] = [],
): Promise<void> {
  const frameworkTables = [
    "kumiko_events",
    "kumiko_event_consumers",
    "kumiko_archived_streams",
    "kumiko_snapshots",
    "kumiko_projections",
  ];
  const extraNames = extraTables.map((t) => (typeof t === "string" ? t : getTableName(t)));
  const allTables = [...frameworkTables, ...extraNames];
  await stack.db.db.execute(sql.raw(`TRUNCATE ${allTables.join(", ")} RESTART IDENTITY CASCADE`));
  if (stack.eventDispatcher) {
    await stack.eventDispatcher.ensureRegistered();
  }
}
