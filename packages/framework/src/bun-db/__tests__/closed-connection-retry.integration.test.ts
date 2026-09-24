// Proves the closed-connection retry against a real postgres-js driver error,
// plus the Bun.SQL matcher and both drivers' extractPgError — see query.ts.

import { afterAll, describe, expect, test } from "bun:test";
import postgres from "postgres";
import { constraintOf, extractPgError, isUniqueViolation } from "../../db/pg-error";
import { testDatabaseUrl } from "../../testing/closed-connection-error";
import { waitFor } from "../../testing/wait-for";
import { isClosedConnectionError, unsafeReadRetrying } from "../query";

const DATABASE_URL = testDatabaseUrl();

// Terminate targets only the backend running the slow query so the retry
// lands on the pool's idle connection instead of reconnecting — a postgres-js
// reconnect under Bun can hang until connect_timeout (30s).
const adminClient = postgres(DATABASE_URL, { max: 1 });
afterAll(async () => {
  await adminClient.end({ timeout: 0 });
});

type UnsafeFn = (sql: string, params?: readonly unknown[]) => Promise<readonly unknown[]>;
type Pool = { unsafe: UnsafeFn };

// Counts unsafe() calls while forwarding everything (including begin/
// savepoint/options) to the real handle — no mocked behavior, only counting.
type CountingClient<T> = T & { readonly calls: number };
function countingClient<T extends Pool>(real: T): CountingClient<T> {
  let calls = 0;
  return new Proxy(real, {
    get(target, prop, receiver) {
      if (prop === "calls") return calls;
      if (prop === "unsafe") {
        return async (...args: Parameters<UnsafeFn>) => {
          calls++;
          return target.unsafe(...args);
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as CountingClient<T>;
}

function randomAppName(): string {
  return `kumiko-cc-retry-${crypto.randomUUID()}`;
}

// Waits for the slow query's backend to show up as the single active
// session before terminating exactly that one — the pg_sleep(0.3) window
// bounds this, so short fixed delays instead of waitFor's default backoff.
async function pollForActivePid(applicationName: string, queryLike: string): Promise<number> {
  let pid: number | undefined;
  await waitFor(
    async () => {
      const rows = (await adminClient.unsafe(
        "select pid from pg_stat_activity where application_name = $1 and state = 'active' and query like $2",
        [applicationName, queryLike],
      )) as readonly { pid: number }[];
      if (rows.length === 1 && rows[0]?.pid !== undefined) {
        pid = rows[0].pid;
        return true;
      }
      return false;
    },
    { delays: Array(100).fill(10) },
  );
  if (pid === undefined) {
    throw new Error(`pollForActivePid: no single active backend found for ${applicationName}`);
  }
  return pid;
}

async function terminateBackendPid(pid: number): Promise<void> {
  await adminClient.unsafe("select pg_terminate_backend($1)", [pid]);
}

type DriverKind = "postgres-js" | "bun-sql";

function makePool(kind: DriverKind, max: number, applicationName: string): Pool {
  if (kind === "postgres-js") {
    return postgres(DATABASE_URL, {
      max,
      connection: { application_name: applicationName },
    }) as unknown as Pool;
  }
  return new Bun.SQL({
    url: DATABASE_URL,
    max,
    connection: { application_name: applicationName },
  }) as unknown as Pool;
}

async function closePool(kind: DriverKind, pool: unknown): Promise<void> {
  if (kind === "postgres-js") {
    await (pool as { end: (opts?: { timeout?: number }) => Promise<void> }).end({ timeout: 0 });
  } else {
    await (pool as { close: () => Promise<void> }).close();
  }
}

const drivers: DriverKind[] = ["postgres-js", "bun-sql"];

// postgres-js only: Bun.SQL sporadically emits an unhandled reject from its
// internal handleClose in this terminate window, and isn't the prod driver.
// Multi-retry (≥3 calls) is covered deterministically by the fake-client
// test in select-many-retry.integration.test.ts instead of a second live test.
test("retries through a real server-side connection close", async () => {
  const applicationName = randomAppName();
  const pool = postgres(DATABASE_URL, {
    max: 2,
    connection: { application_name: applicationName },
  });
  try {
    await Promise.all([pool.unsafe("select 1"), pool.unsafe("select 1")]);
    const counted = countingClient(pool as unknown as Pool);
    const pending = unsafeReadRetrying(counted as never, "select 1 as x from pg_sleep(0.3)", []);
    const pid = await pollForActivePid(applicationName, "%pg_sleep(0.3)%");
    await terminateBackendPid(pid);
    const rows = await pending;
    expect([...rows]).toEqual([{ x: 1 }]);
    expect(counted.calls).toBe(2);
  } finally {
    await pool.end({ timeout: 0 });
  }
});

test("Bun.SQL closed-connection error matches isClosedConnectionError", async () => {
  const pool = new Bun.SQL({ url: DATABASE_URL, max: 1 });
  await pool.unsafe("select 1");
  await pool.close();
  const caught = await pool.unsafe("select 1").catch((e: unknown) => e);
  // @cast-boundary error-details — asserting the real driver error shape
  expect((caught as { code?: string }).code).toBe("ERR_POSTGRES_CONNECTION_CLOSED");
  expect(isClosedConnectionError(caught)).toBe(true);
});

describe.each(drivers)("extractPgError — %s unique-violation SQLSTATE", (kind) => {
  test("isUniqueViolation and constraintOf resolve the real driver error", async () => {
    const applicationName = randomAppName();
    const pool = makePool(kind, 1, applicationName);
    const tableName = `cc_retry_uniq_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
    await pool.unsafe(
      `create table "${tableName}" (id uuid not null, constraint "${tableName}_pk" primary key (id))`,
    );
    try {
      const fixedId = crypto.randomUUID();
      await pool.unsafe(`insert into "${tableName}" (id) values ($1)`, [fixedId]);
      const caught = await pool
        .unsafe(`insert into "${tableName}" (id) values ($1)`, [fixedId])
        .catch((e: unknown) => e);
      expect(isUniqueViolation(caught)).toBe(true);
      expect(extractPgError(caught)?.code).toBe("23505");
      expect(constraintOf(caught)).toBeDefined();
    } finally {
      await pool.unsafe(`drop table if exists "${tableName}"`);
      await closePool(kind, pool);
    }
  });
});
