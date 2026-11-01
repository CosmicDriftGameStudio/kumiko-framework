import type { AnyDb } from "../query.ts";
import { asRawClient } from "../query.ts";

// Blocks until the lock is free. The lock is session-scoped, so lock, work and
// unlock share one reserved connection; pool calls may land on different sessions.
export async function withSessionAdvisoryLock<T>(
  db: AnyDb,
  key: number,
  fn: () => Promise<T>,
): Promise<T> {
  const client = asRawClient(db);
  if (typeof client.reserve !== "function") {
    throw new Error("withSessionAdvisoryLock: db has no .reserve() (need a Bun.SQL pool)");
  }
  const conn = await client.reserve();
  try {
    // Waiting for a peer must not hit the pool's statement_timeout (57014 would crash the waiter's boot).
    await conn.unsafe("SET statement_timeout = 0");
    await conn.unsafe(`SELECT pg_advisory_lock($1)`, [key]);
    try {
      return await fn();
    } finally {
      // A dropped session already released its lock; failing here would mask fn's outcome.
      await conn.unsafe(`SELECT pg_advisory_unlock($1)`, [key]).catch(() => undefined);
      await conn.unsafe("RESET statement_timeout").catch(() => undefined);
    }
  } finally {
    await conn.release();
  }
}

export type TryAdvisoryLockResult<T> =
  | { readonly acquired: true; readonly value: T }
  | { readonly acquired: false };

// Same session scoping as withSessionAdvisoryLock, but a peer holding the lock makes the
// caller skip instead of wait: for work that only needs to run once across replicas.
export async function tryWithSessionAdvisoryLock<T>(
  db: AnyDb,
  key: number,
  fn: () => Promise<T>,
): Promise<TryAdvisoryLockResult<T>> {
  const client = asRawClient(db);
  if (typeof client.reserve !== "function") {
    throw new Error("tryWithSessionAdvisoryLock: db has no .reserve() (need a Bun.SQL pool)");
  }
  const conn = await client.reserve();
  try {
    const rows = await conn.unsafe<{ locked: boolean }>(
      `SELECT pg_try_advisory_lock($1) AS "locked"`,
      [key],
    );
    if (rows[0]?.locked !== true) return { acquired: false };
    try {
      return { acquired: true, value: await fn() };
    } finally {
      await conn.unsafe(`SELECT pg_advisory_unlock($1)`, [key]).catch(() => undefined);
    }
  } finally {
    await conn.release();
  }
}
