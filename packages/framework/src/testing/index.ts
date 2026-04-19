import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { v4 as uuid } from "uuid";
import { buildDrizzleTable } from "../db/table-builder";

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

export async function createTestDb(baseUrl?: string): Promise<TestDb> {
  const url = baseUrl ?? requireEnv("TEST_DATABASE_URL");
  const dbName = `kumiko_test_${uuid().slice(0, 8)}`;
  const adminUrl = url.replace(/\/[^/]+$/, "/postgres");

  const adminClient = postgres(adminUrl);
  await adminClient.unsafe(`CREATE DATABASE "${dbName}"`);
  await adminClient.end();

  const testUrl = url.replace(/\/[^/]+$/, `/${dbName}`);
  const client = postgres(testUrl);
  const db = drizzle(client);

  // Every ES-entity writes events; auto-create the events table so tests that
  // go straight to createTestDb (not setupTestStack) also work out of the box.
  const { createEventsTable } = await import("../event-store");
  await createEventsTable(db);

  return {
    db,
    client,
    dbName,
    cleanup: async () => {
      await client.end();
      const admin = postgres(adminUrl);
      try {
        await admin.unsafe(`DROP DATABASE IF EXISTS "${dbName}"`);
      } finally {
        await admin.end();
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
  const prefix = `kt:${uuid().slice(0, 8)}:`;
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
