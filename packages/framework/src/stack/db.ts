import postgres from "postgres";
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
  db: ReturnType<typeof postgres>;
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
  const db = client;

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

export { requireEnv };
