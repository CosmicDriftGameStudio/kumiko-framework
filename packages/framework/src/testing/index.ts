import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { v4 as uuid } from "uuid";
import { toTableName } from "../db/table-builder";

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

export async function createTestTable(
  db: ReturnType<typeof drizzle>,
  tableSql: string,
): Promise<void> {
  await db.execute(sql.raw(tableSql));
}

/**
 * Creates a table from an EntityDefinition — no manual SQL needed.
 * Generates base columns + entity field columns, matching buildDrizzleTable output.
 */
export async function createEntityTable(
  db: ReturnType<typeof drizzle>,
  entity: import("../engine/types").EntityDefinition,
  entityName?: string,
): Promise<void> {
  const columns: string[] = [
    '"id" SERIAL PRIMARY KEY',
    '"tenant_id" INTEGER NOT NULL',
    '"version" INTEGER DEFAULT 1 NOT NULL',
    '"inserted_at" TIMESTAMP DEFAULT NOW() NOT NULL',
    '"modified_at" TIMESTAMP',
    '"inserted_by_id" INTEGER',
    '"modified_by_id" INTEGER',
  ];

  if (entity.softDelete) {
    columns.push(
      '"is_deleted" BOOLEAN DEFAULT FALSE NOT NULL',
      '"deleted_at" TIMESTAMP',
      '"deleted_by_id" INTEGER',
    );
  }

  for (const [name, field] of Object.entries(entity.fields)) {
    const col = fieldToSqlColumn(name, field);
    if (col) columns.push(col);
  }

  const tableName = entity.table ?? (entityName ? toTableName(entityName) : undefined);
  if (!tableName) throw new Error("Entity has no table name — set entity.table or pass entityName");
  await db.execute(sql.raw(`CREATE TABLE "${tableName}" (\n  ${columns.join(",\n  ")}\n)`));
}

function fieldToSqlColumn(
  name: string,
  field: import("../engine/types").FieldDefinition,
): string | null {
  const sn = name.replace(/[A-Z]/g, (l) => `_${l.toLowerCase()}`);
  switch (field.type) {
    case "text":
    case "select":
      return `"${sn}" TEXT`;
    case "number":
      return `"${sn}" INTEGER`;
    case "money":
      return `"${sn}" NUMERIC(19,4)`;
    case "boolean":
      return field.default !== undefined
        ? `"${sn}" BOOLEAN DEFAULT ${String(field.default).toUpperCase()} NOT NULL`
        : `"${sn}" BOOLEAN`;
    case "date":
      return `"${sn}" TIMESTAMP`;
    case "file":
    case "image":
      return `"${sn}" INTEGER`;
    case "files":
    case "images":
      return null;
  }
}
