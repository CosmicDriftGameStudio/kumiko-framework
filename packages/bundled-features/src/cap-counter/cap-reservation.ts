import {
  deleteMany,
  isUniqueViolation,
  runInOwnTransaction,
  type TenantDb,
} from "@cosmicdrift/kumiko-framework/db";
import type { SessionUser } from "@cosmicdrift/kumiko-framework/engine";
import { UnprocessableError } from "@cosmicdrift/kumiko-framework/errors";
import { generateId } from "@cosmicdrift/kumiko-framework/utils";
import type {
  ReservationConfirmContext,
  ReservationHandle,
} from "@cosmicdrift/kumiko-types/handlers";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import {
  applyCapDeltaOn,
  type BookCapUsageOptions,
  type CapCounterContext,
  type CapDelta,
  resolveCapCounterScope,
} from "./book-cap-usage.ts";
import { capSubjectHash } from "./cap-subject.ts";
import {
  CAP_RESERVATION_TTL_MINUTES,
  CAP_SETTLED_TOMBSTONE_TTL_MINUTES,
} from "./constants.ts";
import { capReservationsTable } from "./tables.ts";

type CapReservationRow = {
  readonly id: string;
  readonly capName: string;
  readonly kind: "calendar";
  readonly periodStartIso: string | null;
  readonly amount: number;
  readonly expiresAt: Temporal.Instant;
  readonly createdAt: Temporal.Instant;
  readonly settledAt: Temporal.Instant | null;
  // Units consume already turned into booked ones; the counter holds them on top of amount.
  readonly consumedAmount: number;
  readonly releasedAt: Temporal.Instant | null;
  readonly subjectHash: string | null;
};

type ReservationRowDraft = Pick<CapReservationRow, "capName" | "kind" | "amount"> &
  Pick<Partial<CapReservationRow>, "periodStartIso" | "subjectHash">;

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
    settledAt: null,
    consumedAmount: 0,
    releasedAt: null,
    subjectHash: draft.subjectHash ?? null,
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
  Pick<BookCapUsageOptions, "subjectKey"> &
  Pick<CapDelta, "guardTenantValue" | "guardSubjectValue">;

function hashOfSubjectKey(subjectKey: string | undefined): string | null {
  return subjectKey === undefined ? null : capSubjectHash(subjectKey);
}

// The counter increment and the reservation row commit together, so a booked amount never exists
// without a row that can give it back.
export async function reserveCalendarCap(
  ctx: CapCounterContext,
  options: ReserveCalendarCapOptions,
  outsideTransaction = true,
): Promise<CalendarCapReservation> {
  const { user, writeDb } = resolveCapCounterScope(ctx, outsideTransaction);
  const id = generateId();
  const subjectHash = hashOfSubjectKey(options.subjectKey);
  const counterValue = await runInOwnTransaction(writeDb, async (txDb) => {
    const tenantValue = await applyCapDeltaOn(
      txDb,
      user,
      {
        capName: options.capName,
        periodStartIso: options.periodStartIso,
        amount: options.amount,
        subjectHash,
        ...(options.guardTenantValue && { guardTenantValue: options.guardTenantValue }),
        ...(options.guardSubjectValue && { guardSubjectValue: options.guardSubjectValue }),
      },
      "add",
    );
    await insertReservationRow(txDb, user, id, {
      capName: options.capName,
      kind: "calendar",
      periodStartIso: options.periodStartIso,
      amount: options.amount,
      subjectHash,
    });
    return tenantValue;
  });
  return { ...toHandle(ctx, id, outsideTransaction), reservationId: id, counterValue };
}

// Deleting the row takes its row lock inside the handler transaction, so a release started after a
// failed COMMIT waits for the real outcome and finds the row gone when the commit went through.
async function confirmCapReservation(
  confirm: ReservationConfirmContext,
  id: string,
): Promise<void> {
  await deleteMany(confirm.tx, capReservationsTable, {
    id,
    tenantId: confirm.tenantId,
    settledAt: null,
    releasedAt: null,
  });
}

async function giveBackCalendar(
  txDb: TenantDb,
  user: SessionUser,
  row: CapReservationRow,
): Promise<void> {
  if (row.periodStartIso === null) {
    throw new Error(`cap-counter: calendar reservation ${row.id} has no period to release against`);
  }
  // Fully consumed by consumeCalendarCapReservation: nothing left to give back.
  if (row.amount === 0) return;
  await applyCapDeltaOn(
    txDb,
    user,
    {
      capName: row.capName,
      periodStartIso: row.periodStartIso,
      amount: row.amount,
      subjectHash: row.subjectHash,
    },
    "subtract",
  );
}

async function giveBackReservation(
  txDb: TenantDb,
  user: SessionUser,
  id: string,
): Promise<void> {
  const ownRow = { id, tenantId: user.tenantId };
  const row = await txDb.fetchOne<CapReservationRow>(capReservationsTable, {
    ...ownRow,
    settledAt: null,
  });
  if (!row) return;
  const claimed = await claimReservationRow(txDb, user, row);
  if (!claimed || claimed.releasedAt !== null) return;
  await giveBackCalendar(txDb, user, claimed);
  // Only consumed units need remembering: a later settle or consume must not count them twice.
  if (claimed.consumedAmount === 0) {
    await txDb.deleteMany(capReservationsTable, ownRow);
    return;
  }
  const now = Temporal.Now.instant();
  await txDb.updateMany(
    capReservationsTable,
    {
      amount: 0,
      releasedAt: now,
      expiresAt: now.add({ minutes: CAP_SETTLED_TOMBSTONE_TTL_MINUTES }),
    },
    ownRow,
  );
}

// Waits for a confirm still holding the row; undefined means that confirm or a settle won (Postgres
// re-checks settled_at after the lock wait). A released row is claimed too: callers branch on
// releasedAt. The returned row is read after the lock wait, so it already includes a concurrent
// consume.
async function claimReservationRow(
  txDb: TenantDb,
  user: SessionUser,
  row: CapReservationRow,
): Promise<CapReservationRow | undefined> {
  const [claimed] = await txDb.updateMany<CapReservationRow>(
    capReservationsTable,
    { expiresAt: row.expiresAt },
    { id: row.id, tenantId: user.tenantId, settledAt: null },
  );
  return claimed;
}

export async function releaseCapReservation(
  ctx: CapCounterContext,
  id: string,
  outsideTransaction = true,
): Promise<void> {
  const { user, writeDb } = resolveCapCounterScope(ctx, outsideTransaction);
  await runInOwnTransaction(writeDb, (txDb) => giveBackReservation(txDb, user, id));
}

export type SettleCalendarCapOptions = {
  readonly capName: string;
  readonly periodStartIso: string;
  readonly subjectKey?: string;
  // Total used, including units already consumed through a handle.
  readonly actualAmount: number;
};

export class CapSettleBelowConsumedError extends UnprocessableError {
  constructor(capName: string, consumed: number, actualAmount: number) {
    super("cap_settle_below_consumed", {
      message: `Cap "${capName}": cannot settle ${actualAmount}, ${consumed} units were already consumed.`,
      details: { capName, consumed, actualAmount },
    });
  }
}

export class CapReservationSettledError extends UnprocessableError {
  constructor(capName: string) {
    super("cap_reservation_settled", {
      message: `Cap "${capName}": the reservation is already settled, consume is no longer possible.`,
      details: { capName },
    });
  }
}

async function bookCalendarDelta(
  txDb: TenantDb,
  user: SessionUser,
  period: Pick<SettleCalendarCapOptions, "capName" | "periodStartIso">,
  delta: number,
  subjectHash: string | null,
): Promise<void> {
  if (delta === 0) return;
  await applyCapDeltaOn(
    txDb,
    user,
    { ...period, amount: Math.abs(delta), subjectHash },
    delta > 0 ? "add" : "subtract",
  );
}

// Asked after a missed or lost claim. A released tombstone committed since the first read does not
// count: the caller's own tombstone insert then conflicts with it, and the retry claims that row.
async function hasSettledTombstone(
  txDb: TenantDb,
  user: SessionUser,
  id: string,
): Promise<boolean> {
  const settled = await txDb.fetchOne<CapReservationRow>(capReservationsTable, {
    id,
    tenantId: user.tenantId,
    settledAt: { ne: null },
  });
  return settled !== undefined;
}

async function settleInTransaction(
  txDb: TenantDb,
  user: SessionUser,
  id: string,
  options: SettleCalendarCapOptions,
): Promise<void> {
  const ownRow = { id, tenantId: user.tenantId };
  const open = await txDb.fetchOne<CapReservationRow>(capReservationsTable, {
    ...ownRow,
    settledAt: null,
  });
  const claimed = open && (await claimReservationRow(txDb, user, open));
  if (claimed) {
    if (options.actualAmount < claimed.consumedAmount) {
      throw new CapSettleBelowConsumedError(
        options.capName,
        claimed.consumedAmount,
        options.actualAmount,
      );
    }
    const alreadyBooked = claimed.amount + claimed.consumedAmount;
    await bookCalendarDelta(
      txDb,
      user,
      options,
      options.actualAmount - alreadyBooked,
      claimed.subjectHash,
    );
    const now = Temporal.Now.instant();
    await txDb.updateMany(
      capReservationsTable,
      { settledAt: now, expiresAt: now.add({ minutes: CAP_SETTLED_TOMBSTONE_TTL_MINUTES }) },
      ownRow,
    );
    return;
  }
  if (await hasSettledTombstone(txDb, user, id)) return;
  // Row swept or released: its amount was given back, so the full actual amount is booked and a
  // tombstone makes a repeated settle a no-op. A parallel settle or consume inserting first fails
  // this insert.
  const subjectHash = hashOfSubjectKey(options.subjectKey);
  await bookCalendarDelta(txDb, user, options, options.actualAmount, subjectHash);
  const now = Temporal.Now.instant();
  await txDb.insertOne(capReservationsTable, {
    ...ownRow,
    capName: options.capName,
    kind: "calendar",
    periodStartIso: options.periodStartIso,
    amount: options.actualAmount,
    expiresAt: now.add({ minutes: CAP_SETTLED_TOMBSTONE_TTL_MINUTES }),
    createdAt: now,
    settledAt: now,
    consumedAmount: 0,
    releasedAt: null,
    subjectHash,
  });
}

// The failed tombstone insert aborts the whole attempt, so nothing was booked; the repeat sees the
// winner's tombstone.
async function retryOnceOnTombstoneRace<T>(attempt: () => Promise<T>): Promise<T> {
  try {
    return await attempt();
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    return attempt();
  }
}

// Replaces the reserved amount by the actual one in a single transaction and keeps the row as a
// settled tombstone, so a repeated settle (retry, lost ack) books nothing twice.
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
  await retryOnceOnTombstoneRace(() =>
    runInOwnTransaction(writeDb, (txDb) => settleInTransaction(txDb, user, id, options)),
  );
}

export type ConsumeCalendarCapOptions = {
  readonly capName: string;
  readonly periodStartIso: string;
  readonly subjectKey?: string;
  readonly units: number;
};

export class CapReservationOverConsumedError extends UnprocessableError {
  constructor(capName: string, remaining: number, requested: number) {
    super("cap_reservation_over_consumed", {
      message: `Cap "${capName}": cannot consume ${requested} units, only ${remaining} still reserved.`,
      details: { capName, remaining, requested },
    });
  }
}

async function consumeClaimedRow(
  txDb: TenantDb,
  user: SessionUser,
  claimed: CapReservationRow,
  options: ConsumeCalendarCapOptions,
): Promise<void> {
  const ownRow = { id: claimed.id, tenantId: user.tenantId };
  if (claimed.releasedAt !== null) {
    // The reserved rest was given back, so each unit is booked on top of what is still counted.
    await bookCalendarDelta(txDb, user, options, options.units, claimed.subjectHash);
    await txDb.updateMany(
      capReservationsTable,
      {
        consumedAmount: claimed.consumedAmount + options.units,
        // Keep the tombstone alive past its last consume, else a later consume would start a fresh one and double count.
        expiresAt: Temporal.Now.instant().add({ minutes: CAP_SETTLED_TOMBSTONE_TTL_MINUTES }),
      },
      ownRow,
    );
    return;
  }
  if (options.units > claimed.amount) {
    throw new CapReservationOverConsumedError(options.capName, claimed.amount, options.units);
  }
  await txDb.updateMany(
    capReservationsTable,
    {
      amount: claimed.amount - options.units,
      consumedAmount: claimed.consumedAmount + options.units,
    },
    ownRow,
  );
}

// Row already expired away: the units are booked directly and a released tombstone remembers them
// so a later settle subtracts them. A parallel consume or settle inserting first fails this insert.
async function consumeWithoutRow(
  txDb: TenantDb,
  user: SessionUser,
  id: string,
  options: ConsumeCalendarCapOptions,
): Promise<void> {
  const subjectHash = hashOfSubjectKey(options.subjectKey);
  await bookCalendarDelta(txDb, user, options, options.units, subjectHash);
  const now = Temporal.Now.instant();
  await txDb.insertOne(capReservationsTable, {
    id,
    tenantId: user.tenantId,
    capName: options.capName,
    kind: "calendar",
    periodStartIso: options.periodStartIso,
    amount: 0,
    expiresAt: now.add({ minutes: CAP_SETTLED_TOMBSTONE_TTL_MINUTES }),
    createdAt: now,
    settledAt: null,
    consumedAmount: options.units,
    releasedAt: now,
    subjectHash,
  });
}

async function consumeInTransaction(
  txDb: TenantDb,
  user: SessionUser,
  id: string,
  options: ConsumeCalendarCapOptions,
): Promise<void> {
  const ownRow = { id, tenantId: user.tenantId };
  const open = await txDb.fetchOne<CapReservationRow>(capReservationsTable, {
    ...ownRow,
    settledAt: null,
  });
  if (open && open.capName !== options.capName) {
    throw new Error(
      `cap-counter: reservation ${id} belongs to cap "${open.capName}", not "${options.capName}"`,
    );
  }
  const claimed = open && (await claimReservationRow(txDb, user, open));
  if (claimed) return consumeClaimedRow(txDb, user, claimed, options);
  if (await hasSettledTombstone(txDb, user, id)) {
    throw new CapReservationSettledError(options.capName);
  }
  return consumeWithoutRow(txDb, user, id, options);
}

// Turns reserved units into booked ones without touching the counter; the row keeps the unconsumed
// rest so a release gives back exactly that. After a release or sweep the units are booked directly.
export async function consumeCalendarCapReservation(
  ctx: CapCounterContext,
  id: string,
  options: ConsumeCalendarCapOptions,
  outsideTransaction = true,
): Promise<void> {
  if (!Number.isInteger(options.units) || options.units < 1) {
    throw new Error(`cap-counter: consume units must be a positive integer, got ${options.units}`);
  }
  const { user, writeDb } = resolveCapCounterScope(ctx, outsideTransaction);
  await retryOnceOnTombstoneRace(() =>
    runInOwnTransaction(writeDb, (txDb) => consumeInTransaction(txDb, user, id, options)),
  );
}

// A failed release leaves its row behind; giving it back once the TTL passed bounds how long that
// capacity stays counted. Expired settled and released tombstones are only deleted: what they
// stand for stays booked.
export async function releaseExpiredCapReservations(
  ctx: CapCounterContext,
  capName: string,
  outsideTransaction = true,
): Promise<void> {
  const { user, writeDb } = resolveCapCounterScope(ctx, outsideTransaction);
  const expiredWhere = {
    tenantId: user.tenantId,
    capName,
    expiresAt: { lt: Temporal.Now.instant() },
  };
  await writeDb.deleteMany(capReservationsTable, {
    ...expiredWhere,
    settledAt: { ne: null },
  });
  await writeDb.deleteMany(capReservationsTable, {
    ...expiredWhere,
    releasedAt: { ne: null },
  });
  const expired = await writeDb.selectMany<Pick<CapReservationRow, "id">>(capReservationsTable, {
    ...expiredWhere,
    settledAt: null,
    releasedAt: null,
  });
  for (const { id } of expired) {
    try {
      await releaseCapReservation(ctx, id, outsideTransaction);
    } catch (error) {
      ctx.obs.log?.error("releasing an expired cap reservation failed", { id, capName, error });
    }
  }
}
