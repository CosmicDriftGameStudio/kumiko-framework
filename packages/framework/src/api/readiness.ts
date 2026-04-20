// Readiness probe: runs a set of checks in parallel with a per-check timeout
// and aggregates into a single result. Used by /health/ready when the caller
// wires DB / Redis / Dispatcher — any of those down drops the probe to 503
// so load balancers stop routing new traffic even while `lifecycle.state()`
// is still "ready".
//
// Design:
//   - Every check produces a `ReadinessCheckResult` — no thrown errors leak.
//   - Timeout is enforced per-check, not per-probe, so a single hung dependency
//     can't starve siblings of their budget.
//   - Checks run in parallel — the probe is called on every kubelet/ALB poll,
//     so total latency must stay ≈ slowest check, not sum.

import { sql } from "drizzle-orm";
import type Redis from "ioredis";
import type { DbConnection } from "../db/connection";
import { getAllConsumerProgress } from "../pipeline/event-dispatcher";

export type ReadinessCheck = {
  readonly name: string;
  readonly run: () => Promise<void>;
};

export type ReadinessCheckResult = {
  readonly name: string;
  readonly ok: boolean;
  readonly latencyMs: number;
  readonly error?: string;
};

export type ReadinessResult = {
  readonly ok: boolean;
  readonly checks: readonly ReadinessCheckResult[];
};

export type ReadinessProbeOptions = {
  readonly timeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 2_000;

export function createReadinessProbe(
  checks: readonly ReadinessCheck[],
  opts: ReadinessProbeOptions = {},
): () => Promise<ReadinessResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return async () => {
    const results = await Promise.all(checks.map((check) => runOne(check, timeoutMs)));
    return {
      ok: results.every((r) => r.ok),
      checks: results,
    };
  };
}

async function runOne(check: ReadinessCheck, timeoutMs: number): Promise<ReadinessCheckResult> {
  const start = performance.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      check.run(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timeout after ${timeoutMs}ms`)), timeoutMs);
        // Don't keep the event loop alive on a hung probe during shutdown.
        timer.unref?.();
      }),
    ]);
    return {
      name: check.name,
      ok: true,
      latencyMs: Math.round(performance.now() - start),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      name: check.name,
      ok: false,
      latencyMs: Math.round(performance.now() - start),
      error: message,
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// --- Standard checks --------------------------------------------------------

export function dbPingCheck(db: DbConnection): ReadinessCheck {
  return {
    name: "db",
    run: async () => {
      await db.execute(sql`SELECT 1`);
    },
  };
}

export function redisPingCheck(redis: Redis): ReadinessCheck {
  return {
    name: "redis",
    run: async () => {
      const reply = await redis.ping();
      if (reply !== "PONG") throw new Error(`unexpected PING reply: ${reply}`);
    },
  };
}

// Lag-Check für den Async-Event-Dispatcher. Liest HWM + Consumer-Cursor aus
// der DB — kein extra Redis/Runtime-State. Fail-Schwelle ist in EventIds
// (bigint), weil das die natürliche Einheit ist (events sind monoton id'd).
// Ein Tuning-Beispiel: maxLagEvents = 1_000 bedeutet "wenn die Projection
// mehr als 1k Events hinter HWM ist, stoppe neue Traffic-Zuweisung".
export function dispatcherLagCheck(
  db: DbConnection,
  consumerNames: readonly string[],
  maxLagEvents: bigint,
): ReadinessCheck {
  return {
    name: "dispatcher_lag",
    run: async () => {
      // skip: no registered consumers means no dispatcher active — lag check has
      // nothing to measure. Not a failure mode, just a no-op.
      if (consumerNames.length === 0) return;
      const progress = await getAllConsumerProgress(db, consumerNames);
      for (const p of progress) {
        if (p.lag > maxLagEvents) {
          throw new Error(`consumer "${p.name}" lag=${p.lag} exceeds threshold ${maxLagEvents}`);
        }
      }
    },
  };
}
