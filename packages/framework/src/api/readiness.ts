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

import type { Redis } from "ioredis";
import type { DbConnection } from "../db/connection.ts";
import { pingDatabase } from "../db/queries/raw-sql.ts";
import { getAllConsumerProgress } from "../pipeline/event-dispatcher.ts";

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

class TimeoutError extends Error {}

export type TimedRunResult<T> =
  | { readonly ok: true; readonly value: T; readonly latencyMs: number }
  | {
      readonly ok: false;
      readonly error: unknown;
      readonly timedOut: boolean;
      readonly latencyMs: number;
    };

export async function runWithTimeout<T>(
  run: () => Promise<T>,
  timeoutMs: number,
): Promise<TimedRunResult<T>> {
  const start = performance.now();
  const elapsedMs = () => Math.round(performance.now() - start);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const value = await Promise.race([
      run(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new TimeoutError(`timeout after ${timeoutMs}ms`)),
          timeoutMs,
        );
        // Don't keep the event loop alive on a hung probe during shutdown.
        timer.unref?.();
      }),
    ]);
    return { ok: true, value, latencyMs: elapsedMs() };
  } catch (error) {
    return {
      ok: false,
      error,
      timedOut: error instanceof TimeoutError,
      latencyMs: elapsedMs(),
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function runOne(check: ReadinessCheck, timeoutMs: number): Promise<ReadinessCheckResult> {
  const result = await runWithTimeout(check.run, timeoutMs);
  if (result.ok) return { name: check.name, ok: true, latencyMs: result.latencyMs };
  return {
    name: check.name,
    ok: false,
    latencyMs: result.latencyMs,
    error: result.error instanceof Error ? result.error.message : String(result.error),
  };
}

// --- Standard checks --------------------------------------------------------

export function dbPingCheck(db: DbConnection): ReadinessCheck {
  return {
    name: "db",
    run: async () => {
      await pingDatabase(db);
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

// Lag check for the asynchronous event dispatcher. Reads the HWM and consumer cursor from
// the database, without relying on extra Redis or runtime state. The failure threshold is
// measured in event IDs (`bigint`), the natural unit because events have monotonically
// increasing IDs. For example, `maxLagEvents = 1_000` stops routing new traffic when the
// projection falls more than 1,000 events behind the HWM.
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
