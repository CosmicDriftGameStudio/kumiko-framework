// Captures a real closed-connection error instead of a hand-built fake —
// the production matcher checks driver-specific codes a fake can't reproduce.

import postgres from "postgres";
import { isClosedConnectionError } from "../bun-db/query";

export function testDatabaseUrl(): string {
  return (
    process.env["TEST_DATABASE_URL"] ??
    process.env["DATABASE_URL"] ??
    "postgresql://kumiko:kumiko@localhost:15432/kumiko_test"
  );
}

const MAX_WARMUP_ROUNDS = 10;
const READS_PER_ROUND = 5;

type AdminClient = { unsafe(sql: string, params?: readonly unknown[]): Promise<unknown> };

// A per-round admin client hits a postgres-js reconnect timing bug (the first
// retry after terminate hangs); a single long-lived admin client avoids it.
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
  const admin = postgres(url, { max: 1 });
  try {
    for (let round = 0; round < MAX_WARMUP_ROUNDS; round++) {
      const applicationName = `kumiko-closed-conn-test-${crypto.randomUUID()}`;
      const pool = postgres(url, { max: 1, connection: { application_name: applicationName } });
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
        await pool.end({ timeout: 0 });
      }
    }
    throw new Error(
      `captureClosedConnectionError: no closed-connection error observed after ${MAX_WARMUP_ROUNDS} rounds.`,
    );
  } finally {
    await admin.end({ timeout: 0 });
  }
}
