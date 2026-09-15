// In-process cap booking for the caller's own tenant; no SystemAdmin dispatch needed.

import type { TenantDb } from "@cosmicdrift/kumiko-framework/db";
import {
  createEntityExecutor,
  type HandlerContext,
  type TenantId,
  type WriteResult,
} from "@cosmicdrift/kumiko-framework/engine";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { Temporal } from "temporal-polyfill";
import { z } from "zod";
import { capCounterAggregateId, rollingCapAggregateId } from "./aggregate-id";
import { CAP_COUNTER_ROLLING_AGGREGATE_TYPE, ROLLING_INCREMENTED_EVENT_QN } from "./constants";
import { capCounterEntity } from "./entity";

const { table, executor } = createEntityExecutor("cap-counter", capCounterEntity);

const capBookingSchema = z.object({
  capName: z.string().min(1).max(100),
  periodStartIso: z.string().min(1),
  amount: z.number().int().positive().default(1),
});

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
  const db = options.outsideTransaction ? requireOutsideTransactionDb(ctx) : ctx.db;
  const aggregateId = capCounterAggregateId(
    ctx.user.tenantId,
    parsed.capName,
    parsed.periodStartIso,
  );

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

export type MarkCapSoftWarnedOptions = {
  readonly capName: string;
  readonly periodStartIso: string;
};

export async function markCapSoftWarned(
  ctx: HandlerContext,
  options: MarkCapSoftWarnedOptions,
): Promise<WriteResult> {
  const aggregateId = capCounterAggregateId(
    ctx.user.tenantId,
    options.capName,
    options.periodStartIso,
  );

  const existing = await ctx.db.selectMany(table, { id: aggregateId }, { limit: 1 });
  if (existing.length === 0) {
    throw new Error(
      `cap-counter: cannot mark-soft-warned, no counter found for tenant=${ctx.user.tenantId} cap=${options.capName} period=${options.periodStartIso}`,
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
}

export type BookRollingCapUsageOptions = {
  readonly capName: string;
  readonly amount?: number;
};

const rollingBookingSchema = z.object({
  capName: z.string().min(1).max(100),
  amount: z.number().int().positive().default(1),
});

export async function bookRollingCapUsage(
  ctx: HandlerContext,
  options: BookRollingCapUsageOptions,
): Promise<{ readonly aggregateId: string; readonly amount: number }> {
  const parsed = rollingBookingSchema.parse(options);
  const aggregateId = rollingCapAggregateId(ctx.user.tenantId, parsed.capName);

  await ctx.unsafeAppendEvent({
    aggregateId,
    aggregateType: CAP_COUNTER_ROLLING_AGGREGATE_TYPE,
    type: ROLLING_INCREMENTED_EVENT_QN,
    payload: {
      capName: parsed.capName,
      amount: parsed.amount,
    },
  });

  return { aggregateId, amount: parsed.amount };
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
