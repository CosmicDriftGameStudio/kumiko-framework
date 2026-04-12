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
  cleanup: () => Promise<void>;
};

export async function createTestRedis(): Promise<TestRedis> {
  const Redis = (await import("ioredis")).default;
  const redisUrl = requireEnv("REDIS_URL");
  const dbIndex = Math.floor(Math.random() * 15) + 1;
  const redis = new Redis(redisUrl, { db: dbIndex });
  await redis.flushdb();

  return {
    redis,
    cleanup: async () => {
      await redis.flushdb();
      redis.disconnect();
    },
  };
}

// --- Shared Test Utilities ---

export { expectError, expectSuccess } from "./assertions";
export { createEventCollector, type EventCollector } from "./event-collector";
export { createTestUser, TestUsers } from "./fixtures";
export type { RequestHelper } from "./request-helper";
export { createRequestHelper } from "./request-helper";
export { createTestDispatcher, type TestDispatcher } from "./test-dispatcher";
export { setupTestStack, type TestStack, type TestStackOptions } from "./test-stack";
export { sleep } from "./utils";
export { waitFor } from "./wait-for";

// --- Helpers ---

/** @deprecated Use createEntityTable instead — will be removed once core-features use Drizzle tables */
export async function createTestTable(
  db: ReturnType<typeof drizzle>,
  tableSql: string,
): Promise<void> {
  await db.execute(sql.raw(tableSql));
}

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
