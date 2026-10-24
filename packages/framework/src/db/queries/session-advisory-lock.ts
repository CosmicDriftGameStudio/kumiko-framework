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
    await conn.unsafe(`SELECT pg_advisory_lock($1)`, [key]);
    try {
      return await fn();
    } finally {
      // A dropped session already released its lock; failing here would mask fn's outcome.
      await conn.unsafe(`SELECT pg_advisory_unlock($1)`, [key]).catch(() => undefined);
    }
  } finally {
    await conn.release();
  }
}
