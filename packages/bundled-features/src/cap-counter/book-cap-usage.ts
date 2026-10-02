// In-process cap booking for the caller's own tenant; no SystemAdmin dispatch needed.

import { runInOwnTransaction, type TenantDb } from "@cosmicdrift/kumiko-framework/db";
import {
  createEntityExecutor,
  type HandlerContext,
  type TenantId,
  type WriteResult,
} from "@cosmicdrift/kumiko-framework/engine";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { Temporal } from "temporal-polyfill";
import * as z from "zod";
import { capCounterAggregateId, rollingCapAggregateId } from "./aggregate-id.js";
import { CAP_COUNTER_ROLLING_AGGREGATE_TYPE, ROLLING_INCREMENTED_EVENT_QN } from "./constants.js";
import { capCounterEntity } from "./entity.js";

const { table, executor } = createEntityExecutor("cap-counter", capCounterEntity);

// periodStartIso feeds the aggregate id and Temporal.Instant.from(); a non-instant string would
// silently fork a counter row on update and throw a RangeError (500) on create.
const capPeriodSchema = z.object({
  capName: z.string().min(1).max(100),
  periodStartIso: z.iso.datetime({ offset: true }),
});

const capBookingSchema = capPeriodSchema.extend({
  amount: z.number().int().positive().default(1),
});

function isLostCounterRace(result: WriteResult): boolean {
  return !result.isSuccess && result.error.code === "version_conflict";
}

// Each attempt writes event + projection atomically, so a conflict means another booker just committed. Contention is bounded by the bookers running at once across ALL replicas on the same DB (not per pool), so the jittered backoff spreads out losers instead of letting them collide again in lockstep; the ceiling only guards against non-convergence.
const MAX_COUNTER_WRITE_ATTEMPTS = 20;
const BACKOFF_JITTER_MS_PER_ATTEMPT = 5;

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function retryCounterWriteOnVersionConflict(
  writeAttempt: () => Promise<WriteResult>,
): Promise<WriteResult> {
  let result: WriteResult = await writeAttempt();
  for (
    let attempt = 1;
    attempt < MAX_COUNTER_WRITE_ATTEMPTS && isLostCounterRace(result);
    attempt++
  ) {
    await sleepMs(Math.random() * attempt * BACKOFF_JITTER_MS_PER_ATTEMPT);
    result = await writeAttempt();
  }
  return result;
}

export type BookCapUsageOptions = {
  readonly capName: string;
  readonly periodStartIso: string;
  readonly amount?: number;
  readonly outsideTransaction?: boolean;
};

function requireOutsideTransactionDb(ctx: HandlerContext): TenantDb {
  if (!ctx.dbOutsideTransaction) {
    throw new Error(
      "cap-counter.bookCapUsage: outsideTransaction requested but ctx.dbOutsideTransaction is undefined",
    );
  }
  return ctx.dbOutsideTransaction;
}

export async function bookCapUsage(
  ctx: HandlerContext,
  options: BookCapUsageOptions,
): Promise<WriteResult> {
  const parsed = capBookingSchema.parse(options);
  const aggregateId = capCounterAggregateId(
    ctx.user.tenantId,
    parsed.capName,
    parsed.periodStartIso,
  );

  async function attemptWrite(db: TenantDb): Promise<WriteResult> {
    const existing = await db.selectMany(table, { id: aggregateId }, { limit: 1 });
    if (existing.length === 0) {
      return executor.create(
        {
          id: aggregateId,
          capName: parsed.capName,
          value: parsed.amount,
          periodStart: Temporal.Instant.from(parsed.periodStartIso),
          lastSoftWarnedAt: null,
        },
        ctx.user,
        db,
      );
    }

    const currentRow = existing[0];
    if (!currentRow) {
      throw new Error("cap-counter.bookCapUsage: row vanished between length-check and read");
    }
    const currentValue = currentRow["value"] as number; // @cast-boundary db-row
    const currentVersion = currentRow["version"] as number; // @cast-boundary db-row
    return executor.update(
      {
        id: aggregateId,
        version: currentVersion,
        changes: { value: currentValue + parsed.amount },
      },
      ctx.user,
      db,
    );
  }

  if (options.outsideTransaction) {
    const outsideDb = requireOutsideTransactionDb(ctx);
    return retryCounterWriteOnVersionConflict(() => runInOwnTransaction(outsideDb, attemptWrite));
  }
  return retryCounterWriteOnVersionConflict(() => attemptWrite(ctx.db));
}

export type MarkCapSoftWarnedOptions = {
  readonly capName: string;
  readonly periodStartIso: string;
};

export async function markCapSoftWarned(
  ctx: HandlerContext,
  options: MarkCapSoftWarnedOptions,
): Promise<WriteResult> {
  const parsed = capPeriodSchema.parse(options);
  const aggregateId = capCounterAggregateId(
    ctx.user.tenantId,
    parsed.capName,
    parsed.periodStartIso,
  );

  return retryCounterWriteOnVersionConflict(async () => {
    const existing = await ctx.db.selectMany(table, { id: aggregateId }, { limit: 1 });
    if (existing.length === 0) {
      throw new Error(
        `cap-counter: cannot mark-soft-warned, no counter found for tenant=${ctx.user.tenantId} cap=${parsed.capName} period=${parsed.periodStartIso}`,
      );
    }
    const row = existing[0];
    if (!row) {
      throw new Error("cap-counter.markCapSoftWarned: row vanished between length-check and read");
    }
    const currentVersion = row["version"] as number; // @cast-boundary db-row

    return executor.update(
      {
        id: aggregateId,
        version: currentVersion,
        changes: { lastSoftWarnedAt: Temporal.Now.instant() },
      },
      ctx.user,
      ctx.db,
    );
  });
}

export type ReadRollingCapUsageOptions = {
  readonly capName: string;
  readonly windowDays: number;
};

// Sums usage without throwing — for callers that only need the raw number
// (e.g. a CapSpec.usage callback), not the enforce-and-throw path.
export async function readRollingCapUsage(
  db: TenantDb,
  tenantId: TenantId,
  options: ReadRollingCapUsageOptions,
): Promise<number> {
  const aggregateId = rollingCapAggregateId(tenantId, options.capName);
  const cutoff = Temporal.Now.instant().subtract({ hours: options.windowDays * 24 });

  const rows = await db.selectMany<{ payload: { amount?: number } }>(eventsTable, {
    tenantId,
    aggregateType: CAP_COUNTER_ROLLING_AGGREGATE_TYPE,
    aggregateId,
    type: ROLLING_INCREMENTED_EVENT_QN,
    createdAt: { gte: cutoff },
  });

  let value = 0;
  for (const row of rows) {
    // @cast-boundary engine-payload — events.payload is jsonb (typed as
    // unknown by drizzle's $type<Record<string,unknown>>); narrowing the
    // shape here mirrors enforceRollingCap's own read-side contract.
    const payload = row["payload"] as { amount?: number };
    if (typeof payload.amount === "number") {
      value += payload.amount;
    }
  }

  return value;
}
