// Captures a real closed-connection error instead of a hand-built fake —
// the production matcher checks driver-specific codes a fake can't reproduce.

import { isClosedConnectionError } from "@cosmicdrift/kumiko-framework/internal/stack-support";
import type { RawDbClient } from "@cosmicdrift/kumiko-types/db-connection";
import { requireEnv } from "../stack/db.ts";

export function testDatabaseUrl(): string {
  return requireEnv("TEST_DATABASE_URL");
}

const MAX_WARMUP_ROUNDS = 10;
const READS_PER_ROUND = 5;

type AdminClient = { unsafe(sql: string, params?: readonly unknown[]): Promise<unknown> };

export async function terminateBackendsByApplicationName(
  admin: AdminClient,
  applicationName: string,
): Promise<void> {
  await admin.unsafe(
    "select pg_terminate_backend(pid) from pg_stat_activity where application_name = $1",
    [applicationName],
  );
}

// Terminates a throwaway pool's backends and races reads right after — the
// dead-connection window is only a few ms wide, so this retries rounds until one lands.
export async function captureClosedConnectionError(
  url: string = testDatabaseUrl(),
): Promise<unknown> {
  const admin = new Bun.SQL(url, { max: 1 });
  try {
    for (let round = 0; round < MAX_WARMUP_ROUNDS; round++) {
      const applicationName = `kumiko-closed-conn-test-${crypto.randomUUID()}`;
      const pool = new Bun.SQL(url, { max: 1, connection: { application_name: applicationName } });
      try {
        await pool.unsafe("select 1");
        await terminateBackendsByApplicationName(admin, applicationName);
        for (let read = 0; read < READS_PER_ROUND; read++) {
          try {
            await pool.unsafe("select 1");
          } catch (err) {
            if (isClosedConnectionError(err)) return err;
          }
        }
      } finally {
        await pool.close({ timeout: 0 });
      }
    }
    throw new Error(
      `captureClosedConnectionError: no closed-connection error observed after ${MAX_WARMUP_ROUNDS} rounds.`,
    );
  } finally {
    await admin.close({ timeout: 0 });
  }
}

export type FakePooledClient = RawDbClient & {
  readonly options: { readonly max: number };
  readonly calls: readonly {
    readonly sql: string;
    readonly params: readonly unknown[] | undefined;
  }[];
};

// Pooled (options.max 1, begin without savepoint/release) so unsafeReadRetrying retries it:
// the first reads throw `failures` in order, every later read answers `[row]`.
export function fakePooledClientFailingWith(
  failures: readonly unknown[],
  row: Record<string, unknown>,
): FakePooledClient {
  const remaining = [...failures];
  const calls: { sql: string; params: readonly unknown[] | undefined }[] = [];
  return {
    options: { max: 1 },
    calls,
    unsafe: async (sql, params) => {
      calls.push({ sql, params });
      if (remaining.length > 0) throw remaining.shift();
      return [row];
    },
    begin: () => Promise.reject(new Error("fakePooledClientFailingWith: begin is not used")),
  };
}
