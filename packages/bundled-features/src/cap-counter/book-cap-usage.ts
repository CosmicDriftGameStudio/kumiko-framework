// In-process cap booking for the caller's own tenant; no SystemAdmin dispatch needed.

import { runInOwnTransaction, type TenantDb } from "@cosmicdrift/kumiko-framework/db";
import type {
  HandlerContext,
  JobContext,
  ReservationContext,
  SessionUser,
  TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import { AccessDeniedError } from "@cosmicdrift/kumiko-framework/errors";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import * as z from "zod";
import { capSubjectHash, TENANT_WIDE_SUBJECT_HASH } from "./cap-subject.ts";
import { ROLLING_CAP_MAX_WINDOW_DAYS } from "./constants.ts";
import { capCountersTable, rollingCapUsageTable } from "./tables.ts";

// periodStartIso goes through Temporal.Instant.from(); a non-instant string would throw a RangeError (500).
const capPeriodSchema = z.object({
  capName: z.string().min(1).max(100),
  periodStartIso: z.iso.datetime({ offset: true }),
});

const COUNTER_CONFLICT_TARGET = ["tenantId", "capName", "periodStart", "subjectHash"] as const;

export type BookCapUsageOptions = {
  readonly capName: string;
  readonly periodStartIso: string;
  readonly amount?: number;
  readonly outsideTransaction?: boolean;
  readonly subjectKey?: string;
};

// Guards run on the value before this booking and a throw must roll the transaction back, so only
// callers that own their transaction pass them.
export type CapDelta = {
  readonly capName: string;
  readonly periodStartIso: string;
  readonly amount: number;
  readonly subjectHash: string | null;
  readonly guardTenantValue?: (valueBefore: number) => void;
  readonly guardSubjectValue?: (valueBefore: number) => void;
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

type CounterRow = { readonly value: number };

function counterKey(
  tenantId: TenantId,
  capName: string,
  periodStart: Temporal.Instant,
  subjectHash: string,
) {
  return { tenantId, capName, periodStart, subjectHash };
}

async function incrementCounterRow(
  db: TenantDb,
  key: ReturnType<typeof counterKey>,
  delta: number,
): Promise<number> {
  const row = await db.upsert<CounterRow>(capCountersTable, key, {
    conflictTarget: COUNTER_CONFLICT_TARGET,
    increment: { value: delta },
  });
  if (!row) throw new Error("cap-counter: counter upsert returned no row");
  return row.value;
}

async function decrementCounterRow(
  db: TenantDb,
  key: ReturnType<typeof counterKey>,
  amount: number,
): Promise<void> {
  const row = await db.upsert<CounterRow>(
    capCountersTable,
    { ...key, value: 0 },
    { conflictTarget: COUNTER_CONFLICT_TARGET, increment: { value: -amount } },
  );
  if (!row) throw new Error("cap-counter: counter upsert returned no row");
  // The counter never drops below 0; a missing row is created at 0, which is the same usage.
  // The row is locked by this transaction, so the clamp cannot race another booking.
  if (row.value < 0) await db.updateMany(capCountersTable, { value: 0 }, key);
}

// Returns the tenant-wide value after the booking.
export async function applyCapDeltaOn(
  db: TenantDb,
  user: SessionUser,
  delta: CapDelta,
  direction: "add" | "subtract",
): Promise<number> {
  const { capName, periodStartIso } = capPeriodSchema.parse(delta);
  if (!Number.isSafeInteger(delta.amount) || delta.amount <= 0) {
    throw new Error(`cap-counter: amount must be a positive integer, got ${delta.amount}`);
  }
  const periodStart = Temporal.Instant.from(periodStartIso);
  const keyFor = (subjectHash: string) =>
    counterKey(user.tenantId, capName, periodStart, subjectHash);

  if (direction === "subtract") {
    await decrementCounterRow(db, keyFor(TENANT_WIDE_SUBJECT_HASH), delta.amount);
    if (delta.subjectHash !== null) {
      await decrementCounterRow(db, keyFor(delta.subjectHash), delta.amount);
    }
    return 0;
  }

  const tenantValue = await incrementCounterRow(db, keyFor(TENANT_WIDE_SUBJECT_HASH), delta.amount);
  delta.guardTenantValue?.(tenantValue - delta.amount);
  if (delta.subjectHash !== null) {
    // Always the tenant row before the subject row: a fixed lock order keeps two bookings of the
    // same tenant from deadlocking on each other.
    const subjectValue = await incrementCounterRow(db, keyFor(delta.subjectHash), delta.amount);
    delta.guardSubjectValue?.(subjectValue - delta.amount);
    // Data minimisation: subject rows of finished periods are not needed, tenant rows stay for billing.
    await db.deleteMany(capCountersTable, {
      tenantId: user.tenantId,
      capName,
      subjectHash: { ne: TENANT_WIDE_SUBJECT_HASH },
      periodStart: { lt: periodStart },
    });
  }
  return tenantValue;
}

function toCapDelta(options: BookCapUsageOptions): CapDelta {
  return {
    capName: options.capName,
    periodStartIso: options.periodStartIso,
    amount: options.amount ?? 1,
    subjectHash: options.subjectKey === undefined ? null : capSubjectHash(options.subjectKey),
  };
}

export async function bookCapUsage(
  ctx: CapCounterContext,
  options: BookCapUsageOptions,
): Promise<{ value: number }> {
  capPeriodSchema.parse(options);
  const { user, writeDb } = resolveCapCounterScope(ctx, options.outsideTransaction === true);
  const delta = toCapDelta(options);
  const value = options.outsideTransaction
    ? await runInOwnTransaction(writeDb, (tx) => applyCapDeltaOn(tx, user, delta, "add"))
    : await applyCapDeltaOn(writeDb, user, delta, "add");
  return { value };
}

export type MarkCapSoftWarnedOptions = {
  readonly capName: string;
  readonly periodStartIso: string;
  readonly outsideTransaction?: boolean;
};

// True only for the call that set the flag.
export async function markCapSoftWarned(
  ctx: CapCounterContext,
  options: MarkCapSoftWarnedOptions,
): Promise<boolean> {
  const parsed = capPeriodSchema.parse(options);
  const { user, writeDb } = resolveCapCounterScope(ctx, options.outsideTransaction === true);
  const key = counterKey(
    user.tenantId,
    parsed.capName,
    Temporal.Instant.from(parsed.periodStartIso),
    TENANT_WIDE_SUBJECT_HASH,
  );

  async function mark(db: TenantDb): Promise<boolean> {
    await db.upsert(capCountersTable, key, {
      conflictTarget: COUNTER_CONFLICT_TARGET,
      increment: { value: 0 },
    });
    // The conditional update re-checks the null after the row lock, so exactly one parallel caller gets true.
    const changed = await db.updateMany(
      capCountersTable,
      { lastSoftWarnedAt: Temporal.Now.instant() },
      { ...key, lastSoftWarnedAt: null },
    );
    return changed.length > 0;
  }

  return options.outsideTransaction ? runInOwnTransaction(writeDb, mark) : mark(writeDb);
}

export type ReadCalendarCapCounterOptions = {
  readonly capName: string;
  readonly periodStartIso: string;
  readonly subjectKey?: string;
};

export type CalendarCapCounter = {
  readonly value: number;
  readonly lastSoftWarnedAt: Temporal.Instant | null;
};

export async function readCalendarCapCounter(
  db: TenantDb,
  tenantId: TenantId,
  options: ReadCalendarCapCounterOptions,
): Promise<CalendarCapCounter | undefined> {
  const { capName, periodStartIso } = capPeriodSchema.parse(options);
  const subjectHash =
    options.subjectKey === undefined
      ? TENANT_WIDE_SUBJECT_HASH
      : capSubjectHash(options.subjectKey);
  const row = await db.fetchOne<CalendarCapCounter>(
    capCountersTable,
    counterKey(tenantId, capName, Temporal.Instant.from(periodStartIso), subjectHash),
  );
  return row && { value: row.value, lastSoftWarnedAt: row.lastSoftWarnedAt };
}

export async function readCalendarCapUsageByTenant(
  db: TenantDb,
  tenantIds: readonly TenantId[],
  options: { readonly capName: string; readonly periodStartIso: string },
): Promise<Map<TenantId, number>> {
  const { capName, periodStartIso } = capPeriodSchema.parse(options);
  const usage = new Map<TenantId, number>(tenantIds.map((tenantId) => [tenantId, 0]));
  if (tenantIds.length === 0) return usage;
  const rows = await db.selectMany<{ tenantId: TenantId; value: number }>(capCountersTable, {
    tenantId: { in: [...tenantIds] },
    subjectHash: TENANT_WIDE_SUBJECT_HASH,
    capName,
    periodStart: Temporal.Instant.from(periodStartIso),
  });
  for (const row of rows) usage.set(row.tenantId, row.value);
  return usage;
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
