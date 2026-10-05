import { deleteMany, runInOwnTransaction, type TenantDb } from "@cosmicdrift/kumiko-framework/db";
import type {
  HandlerContext,
  SessionUser,
  WriteResult,
} from "@cosmicdrift/kumiko-framework/engine";
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
  type ReadRollingCapUsageOptions,
  readRollingCapUsage,
  requireOutsideTransactionDb,
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

async function insertReservationRow(txDb: TenantDb, id: string, draft: ReservationRowDraft) {
  const now = Temporal.Now.instant();
  await txDb.insertOne(capReservationsTable, {
    id,
    capName: draft.capName,
    kind: draft.kind,
    periodStartIso: draft.periodStartIso ?? null,
    amount: draft.amount,
    expiresAt: now.add({ minutes: CAP_RESERVATION_TTL_MINUTES }),
    createdAt: now,
  });
}

function toHandle(ctx: HandlerContext, id: string): ReservationHandle {
  return {
    release: () => releaseCapReservation(ctx, id),
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
  ctx: HandlerContext,
  options: ReserveCalendarCapOptions,
): Promise<ReservationHandle> {
  const outsideDb = requireOutsideTransactionDb(ctx);
  const id = generateId();
  const reserved = await retryCounterWriteOnVersionConflict(() =>
    runInOwnTransaction(outsideDb, async (txDb) => {
      const booked = await applyCapDeltaOn(txDb, ctx.user, options, "add");
      if (!booked.isSuccess) return booked;
      await insertReservationRow(txDb, id, {
        capName: options.capName,
        kind: "calendar",
        periodStartIso: options.periodStartIso,
        amount: options.amount,
      });
      return booked;
    }),
  );
  if (!reserved.isSuccess) throw reraiseAsKumikoError(reserved.error);
  return toHandle(ctx, id);
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
  ctx: HandlerContext,
  options: ReserveRollingCapOptions,
): Promise<ReservationHandle> {
  const outsideDb = requireOutsideTransactionDb(ctx);
  const id = generateId();
  const aggregateId = rollingCapAggregateId(ctx.user.tenantId, options.capName);
  await retryOnStreamVersionConflict(() =>
    runInOwnTransaction(outsideDb, async (txDb) => {
      const version = await getStreamVersionInTenantDb(txDb, aggregateId);
      const usage = await readRollingCapUsage(txDb, ctx.user.tenantId, options);
      options.guardCurrentValue?.(usage);
      await appendEventInTenantDb(
        txDb,
        rollingEvent(
          ctx.user,
          options.capName,
          options.amount,
          version,
          ROLLING_INCREMENTED_EVENT_QN,
        ),
      );
      await insertReservationRow(txDb, id, {
        capName: options.capName,
        kind: "rolling",
        amount: options.amount,
      });
      return NOTHING_TO_RELEASE;
    }),
  );
  return toHandle(ctx, id);
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
  const row = await txDb.fetchOne<CapReservationRow>(capReservationsTable, { id });
  if (!row) return NOTHING_TO_RELEASE;
  // Waits for a confirm still holding the row; zero rows back means that confirm committed.
  const claimed = await txDb.updateMany(capReservationsTable, { expiresAt: row.expiresAt }, { id });
  if (claimed.length === 0) return NOTHING_TO_RELEASE;
  const given =
    row.kind === "rolling"
      ? await giveBackRolling(txDb, user, row)
      : await giveBackCalendar(txDb, user, row);
  if (!given.isSuccess) return given;
  await txDb.deleteMany(capReservationsTable, { id });
  return given;
}

export async function releaseCapReservation(ctx: HandlerContext, id: string): Promise<void> {
  const outsideDb = requireOutsideTransactionDb(ctx);
  const released = await retryOnStreamVersionConflict(() =>
    retryCounterWriteOnVersionConflict(() =>
      runInOwnTransaction(outsideDb, (txDb) => giveBackReservation(txDb, ctx.user, id)),
    ),
  );
  if (!released.isSuccess) throw reraiseAsKumikoError(released.error);
}

// A failed release leaves its row behind; giving it back once the TTL passed bounds how long that
// capacity stays counted.
export async function releaseExpiredCapReservations(
  ctx: HandlerContext,
  capName: string,
): Promise<void> {
  const outsideDb = requireOutsideTransactionDb(ctx);
  const expired = await outsideDb.selectMany<Pick<CapReservationRow, "id">>(capReservationsTable, {
    tenantId: ctx.user.tenantId,
    capName,
    expiresAt: { lt: Temporal.Now.instant() },
  });
  for (const { id } of expired) {
    try {
      await releaseCapReservation(ctx, id);
    } catch (error) {
      ctx.log?.error("releasing an expired cap reservation failed", { id, capName, error });
    }
  }
}
