import { deleteMany, runInOwnTransaction, type TenantDb } from "@cosmicdrift/kumiko-framework/db";
import type { SessionUser, WriteResult } from "@cosmicdrift/kumiko-framework/engine";
import { reraiseAsKumikoError } from "@cosmicdrift/kumiko-framework/errors";
import {
  appendEventInTenantDb,
  getStreamVersionInTenantDb,
} from "@cosmicdrift/kumiko-framework/event-store";
import { generateId } from "@cosmicdrift/kumiko-framework/utils";
import type {
  ReservationConfirmContext,
  ReservationHandle,
} from "@cosmicdrift/kumiko-types/handlers";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import { rollingCapAggregateId } from "./aggregate-id.js";
import {
  applyCapDeltaOn,
  type BookCapUsageOptions,
  type CapCounterContext,
  type ReadRollingCapUsageOptions,
  readRollingCapUsage,
  resolveCapCounterScope,
  retryCounterWriteOnVersionConflict,
  retryOnStreamVersionConflict,
} from "./book-cap-usage.js";
import {
  CAP_COUNTER_ROLLING_AGGREGATE_TYPE,
  CAP_RESERVATION_TTL_MINUTES,
  ROLLING_INCREMENTED_EVENT_QN,
  ROLLING_RELEASED_EVENT_QN,
} from "./constants.js";
import { capReservationsTable } from "./tables.js";

type CapReservationRow = {
  readonly id: string;
  readonly capName: string;
  readonly kind: "calendar" | "rolling";
  readonly periodStartIso: string | null;
  readonly amount: number;
  readonly expiresAt: Temporal.Instant;
};

const NOTHING_TO_RELEASE: WriteResult = { isSuccess: true, data: {} };

type ReservationRowDraft = Pick<CapReservationRow, "capName" | "kind" | "amount"> &
  Pick<Partial<CapReservationRow>, "periodStartIso">;

async function insertReservationRow(
  txDb: TenantDb,
  user: SessionUser,
  id: string,
  draft: ReservationRowDraft,
) {
  const now = Temporal.Now.instant();
  await txDb.insertOne(capReservationsTable, {
    id,
    tenantId: user.tenantId,
    capName: draft.capName,
    kind: draft.kind,
    periodStartIso: draft.periodStartIso ?? null,
    amount: draft.amount,
    expiresAt: now.add({ minutes: CAP_RESERVATION_TTL_MINUTES }),
    createdAt: now,
  });
}

export type CalendarCapReservation = ReservationHandle & {
  readonly reservationId: string;
  // Counter value right after this reservation was booked.
  readonly counterValue: number;
};

function toHandle(
  ctx: CapCounterContext,
  id: string,
  outsideTransaction: boolean,
): ReservationHandle {
  return {
    release: () => releaseCapReservation(ctx, id, outsideTransaction),
    confirmInTransaction: (confirm) => confirmCapReservation(confirm, id),
  };
}

export type ReserveCalendarCapOptions = Required<
  Pick<BookCapUsageOptions, "capName" | "periodStartIso" | "amount">
> &
  Pick<BookCapUsageOptions, "guardCurrentValue">;

// The counter increment and the reservation row commit together, so a booked amount never exists
// without a row that can give it back.
export async function reserveCalendarCap(
  ctx: CapCounterContext,
  options: ReserveCalendarCapOptions,
  outsideTransaction = true,
): Promise<CalendarCapReservation> {
  const { user, writeDb } = resolveCapCounterScope(ctx, outsideTransaction);
  const id = generateId();
  // The last attempt is the one that committed, so this holds the value its increment started from.
  let valueBeforeBooking = 0;
  const observedOptions: ReserveCalendarCapOptions = {
    ...options,
    guardCurrentValue: (currentValue) => {
      options.guardCurrentValue?.(currentValue);
      valueBeforeBooking = currentValue;
    },
  };
  const reserved = await retryCounterWriteOnVersionConflict(() =>
    runInOwnTransaction(writeDb, async (txDb) => {
      const booked = await applyCapDeltaOn(txDb, user, observedOptions, "add");
      if (!booked.isSuccess) return booked;
      await insertReservationRow(txDb, user, id, {
        capName: options.capName,
        kind: "calendar",
        periodStartIso: options.periodStartIso,
        amount: options.amount,
      });
      return booked;
    }),
  );
  if (!reserved.isSuccess) throw reraiseAsKumikoError(reserved.error);
  return {
    ...toHandle(ctx, id, outsideTransaction),
    reservationId: id,
    counterValue: valueBeforeBooking + options.amount,
  };
}

export type ReserveRollingCapOptions = ReadRollingCapUsageOptions & {
  readonly amount: number;
  // Runs on every attempt with the usage seen by that attempt's append.
  readonly guardCurrentValue?: (currentValue: number) => void;
};

function rollingEvent(
  user: SessionUser,
  capName: string,
  amount: number,
  expectedVersion: number,
  type: string,
) {
  return {
    aggregateId: rollingCapAggregateId(user.tenantId, capName),
    aggregateType: CAP_COUNTER_ROLLING_AGGREGATE_TYPE,
    expectedVersion,
    type,
    payload: { capName, amount },
    metadata: { userId: user.id },
  };
}

// The append is version-guarded: a booker that read the usage before another one appended loses the
// race and repeats the whole attempt, so the hard-cap check always sees the stream it appends to.
export async function reserveRollingCap(
  ctx: CapCounterContext,
  options: ReserveRollingCapOptions,
  outsideTransaction = true,
): Promise<ReservationHandle> {
  const { user, writeDb } = resolveCapCounterScope(ctx, outsideTransaction);
  const id = generateId();
  const aggregateId = rollingCapAggregateId(user.tenantId, options.capName);
  await retryOnStreamVersionConflict(() =>
    runInOwnTransaction(writeDb, async (txDb) => {
      const version = await getStreamVersionInTenantDb(txDb, aggregateId);
      const usage = await readRollingCapUsage(txDb, user.tenantId, options);
      options.guardCurrentValue?.(usage);
      await appendEventInTenantDb(
        txDb,
        rollingEvent(user, options.capName, options.amount, version, ROLLING_INCREMENTED_EVENT_QN),
      );
      await insertReservationRow(txDb, user, id, {
        capName: options.capName,
        kind: "rolling",
        amount: options.amount,
      });
      return NOTHING_TO_RELEASE;
    }),
  );
  return toHandle(ctx, id, outsideTransaction);
}

// Deleting the row takes its row lock inside the handler transaction, so a release started after a
// failed COMMIT waits for the real outcome and finds the row gone when the commit went through.
async function confirmCapReservation(
  confirm: ReservationConfirmContext,
  id: string,
): Promise<void> {
  await deleteMany(confirm.tx, capReservationsTable, { id, tenantId: confirm.tenantId });
}

async function giveBackCalendar(
  txDb: TenantDb,
  user: SessionUser,
  row: CapReservationRow,
): Promise<WriteResult> {
  if (row.periodStartIso === null) {
    throw new Error(`cap-counter: calendar reservation ${row.id} has no period to release against`);
  }
  return applyCapDeltaOn(
    txDb,
    user,
    { capName: row.capName, periodStartIso: row.periodStartIso, amount: row.amount },
    "subtract",
  );
}

async function giveBackRolling(
  txDb: TenantDb,
  user: SessionUser,
  row: CapReservationRow,
): Promise<WriteResult> {
  const version = await getStreamVersionInTenantDb(
    txDb,
    rollingCapAggregateId(user.tenantId, row.capName),
  );
  await appendEventInTenantDb(
    txDb,
    rollingEvent(user, row.capName, row.amount, version, ROLLING_RELEASED_EVENT_QN),
  );
  return NOTHING_TO_RELEASE;
}

async function giveBackReservation(
  txDb: TenantDb,
  user: SessionUser,
  id: string,
): Promise<WriteResult> {
  const ownRow = { id, tenantId: user.tenantId };
  const row = await txDb.fetchOne<CapReservationRow>(capReservationsTable, ownRow);
  if (!row) return NOTHING_TO_RELEASE;
  const claimed = await claimReservationRow(txDb, user, row);
  if (!claimed) return NOTHING_TO_RELEASE;
  const given =
    row.kind === "rolling"
      ? await giveBackRolling(txDb, user, row)
      : await giveBackCalendar(txDb, user, row);
  if (!given.isSuccess) return given;
  await txDb.deleteMany(capReservationsTable, ownRow);
  return given;
}

// Waits for a confirm still holding the row; false means that confirm (or another release) won.
async function claimReservationRow(
  txDb: TenantDb,
  user: SessionUser,
  row: CapReservationRow,
): Promise<boolean> {
  const claimed = await txDb.updateMany(
    capReservationsTable,
    { expiresAt: row.expiresAt },
    { id: row.id, tenantId: user.tenantId },
  );
  return claimed.length > 0;
}

export async function releaseCapReservation(
  ctx: CapCounterContext,
  id: string,
  outsideTransaction = true,
): Promise<void> {
  const { user, writeDb } = resolveCapCounterScope(ctx, outsideTransaction);
  const released = await retryOnStreamVersionConflict(() =>
    retryCounterWriteOnVersionConflict(() =>
      runInOwnTransaction(writeDb, (txDb) => giveBackReservation(txDb, user, id)),
    ),
  );
  if (!released.isSuccess) throw reraiseAsKumikoError(released.error);
}

export type SettleCalendarCapOptions = {
  readonly capName: string;
  readonly periodStartIso: string;
  readonly actualAmount: number;
};

function bookCalendarDelta(
  txDb: TenantDb,
  user: SessionUser,
  period: Pick<SettleCalendarCapOptions, "capName" | "periodStartIso">,
  delta: number,
): Promise<WriteResult> {
  if (delta === 0) return Promise.resolve({ isSuccess: true, data: {} });
  return applyCapDeltaOn(
    txDb,
    user,
    { ...period, amount: Math.abs(delta) },
    delta > 0 ? "add" : "subtract",
  );
}

// Replaces the reserved amount by the actual one in a single transaction. When the row is already
// gone (swept or released), the reserved amount was given back, so the full actual amount is booked.
export async function settleCalendarCapReservation(
  ctx: CapCounterContext,
  id: string,
  options: SettleCalendarCapOptions,
  outsideTransaction = true,
): Promise<void> {
  if (!Number.isInteger(options.actualAmount) || options.actualAmount < 0) {
    throw new Error(
      `cap-counter: settle amount must be a non-negative integer, got ${options.actualAmount}`,
    );
  }
  const { user, writeDb } = resolveCapCounterScope(ctx, outsideTransaction);
  const settled = await retryCounterWriteOnVersionConflict(() =>
    runInOwnTransaction(writeDb, async (txDb) => {
      const row = await txDb.fetchOne<CapReservationRow>(capReservationsTable, {
        id,
        tenantId: user.tenantId,
      });
      const claimed = row ? await claimReservationRow(txDb, user, row) : false;
      if (!row || !claimed) {
        return bookCalendarDelta(txDb, user, options, options.actualAmount);
      }
      const booked = await bookCalendarDelta(
        txDb,
        user,
        options,
        options.actualAmount - row.amount,
      );
      if (!booked.isSuccess) return booked;
      await txDb.deleteMany(capReservationsTable, { id, tenantId: user.tenantId });
      return booked;
    }),
  );
  if (!settled.isSuccess) throw reraiseAsKumikoError(settled.error);
}

// A failed release leaves its row behind; giving it back once the TTL passed bounds how long that
// capacity stays counted.
export async function releaseExpiredCapReservations(
  ctx: CapCounterContext,
  capName: string,
  outsideTransaction = true,
): Promise<void> {
  const { user, writeDb } = resolveCapCounterScope(ctx, outsideTransaction);
  const expired = await writeDb.selectMany<Pick<CapReservationRow, "id">>(capReservationsTable, {
    tenantId: user.tenantId,
    capName,
    expiresAt: { lt: Temporal.Now.instant() },
  });
  for (const { id } of expired) {
    try {
      await releaseCapReservation(ctx, id, outsideTransaction);
    } catch (error) {
      ctx.log?.error("releasing an expired cap reservation failed", { id, capName, error });
    }
  }
}
