// Proves the closed-connection retry against a real Bun.SQL driver error
// and extractPgError on a real unique-violation — see query.ts.

import { afterAll, describe, expect, test } from "bun:test";
import { testDatabaseUrl, waitFor } from "@cosmicdrift/kumiko-testing/helpers";
import {
  describeClosedConnectionFailure,
  isClosedConnectionError,
} from "../../closed-connection.ts";
import { constraintOf, extractPgError, isUniqueViolation } from "../../pg-error.ts";
import { unsafeReadRetrying } from "../../query.ts";

const DATABASE_URL = testDatabaseUrl();

// Terminate targets only the backend running the slow query so the retry
// lands on the pool's idle connection instead of reconnecting.
const adminClient = new Bun.SQL(DATABASE_URL, { max: 1 });
afterAll(async () => {
  await adminClient.close({ timeout: 0 });
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

function makePool(max: number, applicationName: string): Bun.SQL {
  return new Bun.SQL(DATABASE_URL, {
    max,
    connection: { application_name: applicationName },
  });
}

// Multi-retry (≥3 calls) is covered deterministically by the fake-client
// test in select-many-retry.integration.test.ts instead of a second live test.
test("retries through a real server-side connection close", async () => {
  const applicationName = randomAppName();
  const pool = makePool(2, applicationName);
  try {
    await Promise.all([pool.unsafe("select 1"), pool.unsafe("select 1")]);
    const counted = countingClient(pool);
    const pending = unsafeReadRetrying(counted as never, "select 1 as x from pg_sleep(0.3)", []);
    const pid = await pollForActivePid(applicationName, "%pg_sleep(0.3)%");
    await terminateBackendPid(pid);
    const rows = await pending;
    expect([...rows]).toEqual([{ x: 1 }]);
    expect(counted.calls).toBe(2);
  } finally {
    await pool.close({ timeout: 0 });
  }
});

test("a closed Bun.SQL pool raises an error that matches isClosedConnectionError", async () => {
  const pool = new Bun.SQL(DATABASE_URL, { max: 1 });
  await pool.unsafe("select 1");
  await pool.close();
  const caught = await pool.unsafe("select 1").catch((e: unknown) => e);
  expect(extractPgError(caught)?.code).toBe("ERR_POSTGRES_CONNECTION_CLOSED");
  expect(isClosedConnectionError(caught)).toBe(true);
});

describe("extractPgError — Bun.SQL unique-violation SQLSTATE", () => {
  test("isUniqueViolation and constraintOf resolve the real driver error", async () => {
    const applicationName = randomAppName();
    const pool = makePool(1, applicationName);
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
      await pool.close({ timeout: 0 });
    }
  });
});

describe("describeClosedConnectionFailure", () => {
  test("describes a real Bun.SQL pool error without SQL text or params", async () => {
    const applicationName = randomAppName();
    const pool = makePool(2, applicationName);
    try {
      await Promise.all([pool.unsafe("select 1"), pool.unsafe("select 1")]);
      const secretParam = `secret-${crypto.randomUUID()}`;
      const pending = pool
        .unsafe("select $1::text as x from pg_sleep(0.3)", [secretParam])
        .catch((e: unknown) => e);
      const pid = await pollForActivePid(applicationName, "%pg_sleep(0.3)%");
      await terminateBackendPid(pid);
      const caught = await pending;

      const described = describeClosedConnectionFailure(pool, caught, 3);
      expect(described).toMatchObject({
        driver: "bun-sql",
        pooled: true,
        attempts: 3,
        poolMax: 2,
      });
      expect(described?.["errorCode"]).toBe(extractPgError(caught)?.code);
      const serialized = JSON.stringify(described);
      expect(serialized).not.toContain(secretParam);
      expect(serialized).not.toContain("pg_sleep");
    } finally {
      await pool.close({ timeout: 0 });
    }
  });

  test("describes a real Bun.SQL transaction handle as not pooled", async () => {
    const applicationName = randomAppName();
    const pool = makePool(2, applicationName);
    try {
      // begin() rejects as soon as the backend dies, while the callback is still awaiting the
      // failed statement; the description is only complete once the callback itself has finished.
      const callbackDone = Promise.withResolvers<Record<string, unknown> | undefined>();
      const beginSettled = pool
        .begin(async (tx) => {
          const pending = tx.unsafe("select 1 from pg_sleep(0.3)").catch((e: unknown) => e);
          const pid = await pollForActivePid(applicationName, "%pg_sleep(0.3)%");
          await terminateBackendPid(pid);
          callbackDone.resolve(describeClosedConnectionFailure(tx, await pending, 1));
        })
        .catch((e: unknown) => e);
      const described = await callbackDone.promise;
      await beginSettled;
      expect(described).toMatchObject({ driver: "bun-sql", pooled: false, attempts: 1 });
    } finally {
      await pool.close({ timeout: 0 });
    }
  });

  test("describes a real closed Bun.SQL pool with its timeouts in milliseconds", async () => {
    const pool = new Bun.SQL({ url: DATABASE_URL, max: 1, idleTimeout: 5, maxLifetime: 10 });
    await pool.unsafe("select 1");
    await pool.close();
    const caught = await pool.unsafe("select 1").catch((e: unknown) => e);

    expect(describeClosedConnectionFailure(pool, caught, 1)).toMatchObject({
      driver: "bun-sql",
      pooled: true,
      poolMax: 1,
      idleTimeoutMs: 5000,
      maxLifetimeMs: 10000,
      errorCode: "ERR_POSTGRES_CONNECTION_CLOSED",
    });
  });

  test("returns undefined for an unrelated error", () => {
    expect(describeClosedConnectionFailure({}, new Error("boom"), 1)).toBeUndefined();
    expect(describeClosedConnectionFailure({}, "not an error", 1)).toBeUndefined();
  });

  test("ignores the AbortError of a client disconnect", () => {
    const abort = new DOMException("The connection was closed.", "AbortError");
    expect(describeClosedConnectionFailure({}, abort, 2)).toBeUndefined();
  });
});
