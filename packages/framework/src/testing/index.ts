import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { v4 as uuid } from "uuid";

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

export { expectSuccess, expectError } from "./assertions";
export { TestUsers, createTestUser } from "./fixtures";
export type { RequestHelper } from "./request-helper";
export { createRequestHelper } from "./request-helper";
export { sleep } from "./utils";

// --- Helpers ---

export async function createTestTable(
  db: ReturnType<typeof drizzle>,
  tableSql: string,
): Promise<void> {
  await db.execute(sql.raw(tableSql));
}
