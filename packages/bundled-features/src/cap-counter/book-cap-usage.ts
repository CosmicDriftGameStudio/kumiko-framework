// In-process cap booking for the caller's own tenant; no SystemAdmin dispatch needed.

import { runInOwnTransaction, type TenantDb } from "@cosmicdrift/kumiko-framework/db";
import {
  createEntityExecutor,
  type HandlerContext,
  type JobContext,
  type ReservationContext,
  type SessionUser,
  type TenantId,
  type WriteResult,
} from "@cosmicdrift/kumiko-framework/engine";
import { AccessDeniedError, isVersionConflictFailure } from "@cosmicdrift/kumiko-framework/errors";
import { VersionConflictError } from "@cosmicdrift/kumiko-framework/event-store";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import * as z from "zod";
import { capCounterAggregateId } from "./aggregate-id.ts";
import { ROLLING_CAP_MAX_WINDOW_DAYS } from "./constants.ts";
import { capCounterEntity } from "./entity.ts";
import { rollingCapUsageTable } from "./tables.ts";

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

// Each attempt writes event + projection atomically, so a conflict means another booker just committed. Contention is bounded by the bookers running at once across ALL replicas on the same DB (not per pool), so the jittered backoff spreads out losers instead of letting them collide again in lockstep; the ceiling only guards against non-convergence.
const MAX_COUNTER_WRITE_ATTEMPTS = 20;
const BACKOFF_JITTER_MS_PER_ATTEMPT = 5;

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function retryCounterWriteOnVersionConflict(
  writeAttempt: () => Promise<WriteResult>,
): Promise<WriteResult> {
  let result: WriteResult = await writeAttempt();
  for (
    let attempt = 1;
    attempt < MAX_COUNTER_WRITE_ATTEMPTS && isVersionConflictFailure(result);
    attempt++
  ) {
    await sleepMs(Math.random() * attempt * BACKOFF_JITTER_MS_PER_ATTEMPT);
    result = await writeAttempt();
  }
  return result;
}

// Event-store appends signal a lost race by throwing; the whole attempt (read, guard, append) is repeated.
export async function retryOnStreamVersionConflict<T>(attempt: () => Promise<T>): Promise<T> {
  for (let tries = 1; ; tries++) {
    try {
      return await attempt();
    } catch (error) {
      if (!(error instanceof VersionConflictError) || tries >= MAX_COUNTER_WRITE_ATTEMPTS) {
        throw error;
      }
      await sleepMs(Math.random() * tries * BACKOFF_JITTER_MS_PER_ATTEMPT);
    }
  }
}

export type BookCapUsageOptions = {
  readonly capName: string;
  readonly periodStartIso: string;
  readonly amount?: number;
  readonly outsideTransaction?: boolean;
  // Runs on every attempt with the freshly read value, so a throw rejects the booking against the state it would actually be applied to (a version-conflict retry re-reads and re-checks).
  readonly guardCurrentValue?: (currentValue: number) => void;
};

export type CapCounterContext = HandlerContext | JobContext | ReservationContext;

export type CapCounterScope = {
  readonly user: SessionUser;
  readonly readDb: TenantDb;
  readonly writeDb: TenantDb;
};

// A tenant-mode db pins every row it writes to its own tenant; counter and reservation row would
// silently land on different tenants if that is not the user's.
function assertDbServesUser(db: TenantDb, user: SessionUser): TenantDb {
  if (db.mode === "tenant" && db.tenantId !== user.tenantId) {
    throw new AccessDeniedError({
      message: "cap-counter: the context's database belongs to a different tenant than its user",
    });
  }
  return db;
}

// Jobs write in place (their db is not transaction-bound); systemScope handlers reach both dbs via
// systemDb, because their ctx.db / ctx.db.outsideTransaction are fail-closed proxies.
export function resolveCapCounterScope(
  ctx: CapCounterContext,
  outsideTransaction: boolean,
): CapCounterScope {
  // A job context spread into a handler-shaped one (user set) is a handler context: its user, not
  // the job's systemUser, names the metered tenant.
  if (!("user" in ctx) || !ctx.user) {
    const jobUser = "systemUser" in ctx ? ctx.systemUser : undefined;
    if (!jobUser) {
      throw new Error("cap-counter: ctx.user.tenantId missing — required to resolve the counter");
    }
    const db = assertDbServesUser(ctx.db, jobUser);
    return { user: jobUser, readDb: db, writeDb: db };
  }
  const { user } = ctx;
  if (!user.tenantId) {
    throw new Error("cap-counter: ctx.user.tenantId missing — required to resolve the counter");
  }
  if (ctx.systemDb) {
    const readDb = ctx.systemDb.assertTenantMatch(user.tenantId);
    const writeDb = outsideTransaction
      ? ctx.systemDb.outsideTransaction.assertTenantMatch(user.tenantId)
      : readDb;
    return { user, readDb, writeDb };
  }
  const writeDb = outsideTransaction ? ctx.db.outsideTransaction : ctx.db;
  if (!writeDb) {
    throw new Error(
      outsideTransaction
        ? "cap-counter: outsideTransaction requested but ctx.db.outsideTransaction is undefined"
        : "cap-counter: ctx.db missing — run inside a handler context",
    );
  }
  return {
    user,
    readDb: assertDbServesUser(ctx.db, user),
    writeDb: assertDbServesUser(writeDb, user),
  };
}

export async function bookCapUsage(
  ctx: CapCounterContext,
  options: BookCapUsageOptions,
): Promise<WriteResult> {
  return applyCapDelta(ctx, options, "add");
}

// Gives back a reservation whose operation failed afterwards; the counter never drops below 0.
export async function releaseCapUsage(
  ctx: CapCounterContext,
  options: Omit<BookCapUsageOptions, "guardCurrentValue">,
): Promise<WriteResult> {
  return applyCapDelta(ctx, options, "subtract");
}

// One attempt against an already-open db handle; a lost race comes back as a version_conflict failure the caller retries.
export async function applyCapDeltaOn(
  db: TenantDb,
  user: SessionUser,
  options: BookCapUsageOptions,
  direction: "add" | "subtract",
): Promise<WriteResult> {
  const parsed = capBookingSchema.parse(options);
  const aggregateId = capCounterAggregateId(user.tenantId, parsed.capName, parsed.periodStartIso);

  const existing = await db.selectMany(table, { id: aggregateId }, { limit: 1 });
  if (existing.length === 0) {
    options.guardCurrentValue?.(0);
    if (direction === "subtract") return { isSuccess: true, data: {} };
    return executor.create(
      {
        id: aggregateId,
        capName: parsed.capName,
        value: parsed.amount,
        periodStart: Temporal.Instant.from(parsed.periodStartIso),
        lastSoftWarnedAt: null,
      },
      user,
      db,
    );
  }

  const currentRow = existing[0];
  if (!currentRow) {
    throw new Error("cap-counter.bookCapUsage: row vanished between length-check and read");
  }
  const currentValue = currentRow["value"] as number; // @cast-boundary db-row
  const currentVersion = currentRow["version"] as number; // @cast-boundary db-row
  options.guardCurrentValue?.(currentValue);
  return executor.update(
    {
      id: aggregateId,
      version: currentVersion,
      changes: {
        value:
          direction === "add"
            ? currentValue + parsed.amount
            : Math.max(0, currentValue - parsed.amount),
      },
    },
    user,
    db,
  );
}

async function applyCapDelta(
  ctx: CapCounterContext,
  options: BookCapUsageOptions,
  direction: "add" | "subtract",
): Promise<WriteResult> {
  const { user, writeDb } = resolveCapCounterScope(ctx, options.outsideTransaction === true);
  if (options.outsideTransaction) {
    return retryCounterWriteOnVersionConflict(() =>
      runInOwnTransaction(writeDb, (txDb) => applyCapDeltaOn(txDb, user, options, direction)),
    );
  }
  return retryCounterWriteOnVersionConflict(() =>
    applyCapDeltaOn(writeDb, user, options, direction),
  );
}

export type MarkCapSoftWarnedOptions = {
  readonly capName: string;
  readonly periodStartIso: string;
  readonly outsideTransaction?: boolean;
};

export async function markCapSoftWarned(
  ctx: CapCounterContext,
  options: MarkCapSoftWarnedOptions,
): Promise<WriteResult> {
  const parsed = capPeriodSchema.parse(options);
  const { user, writeDb } = resolveCapCounterScope(ctx, options.outsideTransaction === true);
  const aggregateId = capCounterAggregateId(user.tenantId, parsed.capName, parsed.periodStartIso);

  async function attemptMark(db: TenantDb): Promise<WriteResult> {
    const existing = await db.selectMany(table, { id: aggregateId }, { limit: 1 });
    if (existing.length === 0) {
      throw new Error(
        `cap-counter: cannot mark-soft-warned, no counter found for tenant=${user.tenantId} cap=${parsed.capName} period=${parsed.periodStartIso}`,
      );
    }
    const row = existing[0];
    if (!row) {
      throw new Error("cap-counter.markCapSoftWarned: row vanished between length-check and read");
    }
    // A version-conflict retry lands here after a parallel warner already set the flag; a second
    // write would only append a redundant event with a newer timestamp.
    if (row["lastSoftWarnedAt"] !== null) {
      return { isSuccess: true, data: row };
    }
    const currentVersion = row["version"] as number; // @cast-boundary db-row

    return executor.update(
      {
        id: aggregateId,
        version: currentVersion,
        changes: { lastSoftWarnedAt: Temporal.Now.instant() },
      },
      user,
      db,
    );
  }

  if (options.outsideTransaction) {
    return retryCounterWriteOnVersionConflict(() => runInOwnTransaction(writeDb, attemptMark));
  }
  return retryCounterWriteOnVersionConflict(() => attemptMark(writeDb));
}

export type ReadRollingCapUsageOptions = {
  readonly capName: string;
  readonly windowDays: number;
};

export function rollingBucketStart(at: Temporal.Instant): Temporal.Instant {
  return at.round({ smallestUnit: "hour", roundingMode: "floor" });
}

const readRollingCapUsageSchema = z.object({
  capName: z.string().min(1).max(100),
  windowDays: z.number().int().min(1).max(ROLLING_CAP_MAX_WINDOW_DAYS),
});

// Sums the hourly buckets of the window. The cutoff is floored to the hour, so a read can include up
// to one extra hour at the window's old edge: it over-counts, never under-counts.
export async function readRollingCapUsage(
  db: TenantDb,
  tenantId: TenantId,
  options: ReadRollingCapUsageOptions,
): Promise<number> {
  const { capName, windowDays } = readRollingCapUsageSchema.parse(options);
  const cutoff = rollingBucketStart(Temporal.Now.instant().subtract({ hours: windowDays * 24 }));
  const [total] = await db.aggregate(
    rollingCapUsageTable,
    { measure: { fn: "sum", field: "amount" } },
    { tenantId, capName, bucketStart: { gte: cutoff } },
  );
  return total?.value ?? 0;
}
