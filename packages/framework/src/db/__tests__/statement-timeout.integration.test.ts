import { afterAll, describe, expect, test } from "bun:test";
import { testDatabaseUrl } from "@cosmicdrift/kumiko-testing/helpers";
import {
  createDbConnection,
  DEFAULT_SERVER_IDLE_IN_TRANSACTION_TIMEOUT_MS,
  DEFAULT_SERVER_STATEMENT_TIMEOUT_MS,
  serverTimeoutOptionsFromEnv,
} from "../connection.ts";
import { type Migration, runMigrations } from "../migrate-runner.ts";
import { withoutStatementTimeout } from "../statement-timeout.ts";

const STATEMENT_TIMEOUT_MS = 150;
const SLEEP_PAST_TIMEOUT_SECONDS = 0.6;
const POSTGRES_QUERY_CANCELED = "57014";

const handle = createDbConnection({
  url: testDatabaseUrl(),
  maxConnections: 2,
  statementTimeoutMs: STATEMENT_TIMEOUT_MS,
});
const { db, client } = handle;

afterAll(async () => {
  await handle.close();
});

async function currentStatementTimeout(runner: typeof client): Promise<string> {
  const rows = await runner.unsafe<{ statement_timeout: string }[]>("SHOW statement_timeout");
  return rows[0]?.statement_timeout ?? "";
}

describe("server statement_timeout", () => {
  test("a statement running past the configured timeout is canceled by Postgres", async () => {
    const error = await client
      .unsafe(`SELECT pg_sleep(${SLEEP_PAST_TIMEOUT_SECONDS})`)
      .then(() => undefined)
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ code: POSTGRES_QUERY_CANCELED });
  });

  test("withoutStatementTimeout lets the long statement finish and restores the timeout afterwards", async () => {
    await withoutStatementTimeout(db, async (unbounded) => {
      await unbounded.unsafe(`SELECT pg_sleep(${SLEEP_PAST_TIMEOUT_SECONDS})`);
      const rows = await unbounded.unsafe("SHOW statement_timeout");
      expect(rows[0]).toMatchObject({ statement_timeout: "0" });
    });
    expect(await currentStatementTimeout(client)).toBe(`${STATEMENT_TIMEOUT_MS}ms`);
  });

  test("a migration longer than the timeout still applies, and the pool keeps its timeout", async () => {
    const migration: Migration = {
      id: `zz_statement_timeout_${crypto.randomUUID().slice(0, 8)}`,
      checksum: "statement-timeout-test",
      statements: [`SELECT pg_sleep(${SLEEP_PAST_TIMEOUT_SECONDS});`],
    };
    try {
      const result = await runMigrations(db, [migration]);
      expect(result.applied).toEqual([migration.id]);
      expect(await currentStatementTimeout(client)).toBe(`${STATEMENT_TIMEOUT_MS}ms`);
    } finally {
      await client.unsafe(`DELETE FROM "_kumiko_migrations" WHERE "id" = $1`, [migration.id]);
    }
  });
});

describe("withoutStatementTimeout pool lifecycle", () => {
  test("closing the parent ends the unbounded pool of a run that never settles", async () => {
    const parent = createDbConnection({
      url: testDatabaseUrl(),
      maxConnections: 1,
      statementTimeoutMs: STATEMENT_TIMEOUT_MS,
    });
    const marker = `abandoned_run_${crypto.randomUUID().replaceAll("-", "")}`;
    const backendsOfAbandonedRun = () =>
      client.unsafe<{ pid: number }[]>(
        "SELECT pid FROM pg_stat_activity WHERE query LIKE $1 AND pid <> pg_backend_pid()",
        [`%${marker}%`],
      );
    const queryRan = Promise.withResolvers<void>();
    void withoutStatementTimeout(parent.db, async (unbounded) => {
      await unbounded.unsafe(`SELECT '${marker}'`);
      queryRan.resolve();
      await new Promise<never>(() => {});
    });
    try {
      await queryRan.promise;
      expect(await backendsOfAbandonedRun()).toHaveLength(1);

      await parent.close();

      expect(await backendsOfAbandonedRun()).toHaveLength(0);
    } finally {
      await parent.close();
    }
  });
});

describe("serverTimeoutOptionsFromEnv", () => {
  test("defaults cap statements at 60s, idle transactions at 300s and leave lock_timeout off", () => {
    expect(serverTimeoutOptionsFromEnv({})).toEqual({
      statementTimeoutMs: DEFAULT_SERVER_STATEMENT_TIMEOUT_MS,
      idleInTransactionSessionTimeoutMs: DEFAULT_SERVER_IDLE_IN_TRANSACTION_TIMEOUT_MS,
    });
    expect(DEFAULT_SERVER_STATEMENT_TIMEOUT_MS).toBe(60_000);
    expect(DEFAULT_SERVER_IDLE_IN_TRANSACTION_TIMEOUT_MS).toBe(300_000);
  });

  test("env overrides each limit and 0 switches it off", () => {
    expect(
      serverTimeoutOptionsFromEnv({
        DATABASE_STATEMENT_TIMEOUT_MS: "0",
        DATABASE_IDLE_IN_TRANSACTION_TIMEOUT_MS: "5000",
        DATABASE_LOCK_TIMEOUT_MS: "2000",
      }),
    ).toEqual({
      statementTimeoutMs: 0,
      idleInTransactionSessionTimeoutMs: 5000,
      lockTimeoutMs: 2000,
    });
  });
});
