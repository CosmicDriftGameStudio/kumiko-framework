import {
  type AccessRule,
  defineWriteHandler,
  type WriteResult,
} from "@cosmicdrift/kumiko-framework/engine";
import { NotFoundError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import { generateId } from "@cosmicdrift/kumiko-framework/utils";
import {
  accountExecutor,
  scheduleExecutor,
  transactionExecutor,
  transactionTable,
} from "../executor.ts";
import { findReversedIds, isoMonth } from "../recurring.ts";
import { confirmSchedulePeriodPayloadSchema } from "../schemas.ts";
import { readSubjectReference } from "../subject-reference.ts";
import { DEFAULT_LEDGER_ACCESS } from "../web/constants.ts";

// pg_advisory_xact_lock namespace (int4): 'lcsp' as ASCII, disjoint from the
// framework's other fixed advisory-lock keys.
const CONFIRM_PERIOD_LOCK_NAMESPACE = 0x6c637370;

// confirm-schedule-period — turn ONE projected period of a schedule into a posted,
// balanced transaction (debit +amount / credit −amount), carrying the scheduleId
// and period columns so the host can merge Soll vs. Ist.
//
// Idempotent and reversal-aware: if an ACTIVE (non-reversed) booking for this
// scheduleId + period already exists, it's a no-op; a booking that was reversed (Storno)
// leaves the period re-confirmable. Referential integrity (both accounts must
// exist) mirrors create-transaction because a schedule could name a bogus
// account that the generic CRUD create does not check.
export function createConfirmSchedulePeriodHandler(access: AccessRule = DEFAULT_LEDGER_ACCESS) {
  return defineWriteHandler({
    name: "confirm-schedule-period",
    schema: confirmSchedulePeriodPayloadSchema,
    access,
    description:
      "Turns one month of a recurring schedule into a posted balanced entry between its debit and credit account, returning the existing booking instead when that period is already booked and not reversed; use it to move a forecast period into the actual books.",
    handler: async (event, ctx): Promise<WriteResult<unknown>> => {
      const payload = event.payload;

      const schedule = await scheduleExecutor.detail(
        { id: payload.scheduleId },
        event.user,
        ctx.db,
      );
      if (!schedule) return writeFailure(new NotFoundError("schedule", payload.scheduleId));

      if (
        payload.period < isoMonth(String(schedule["startDate"])) ||
        (schedule["endDate"] != null && payload.period > isoMonth(String(schedule["endDate"])))
      ) {
        return writeFailure(new NotFoundError("schedule-period", payload.period));
      }

      const debitAccountId = String(schedule["debitAccountId"]);
      const creditAccountId = String(schedule["creditAccountId"]);
      for (const accountId of [debitAccountId, creditAccountId]) {
        const account = await accountExecutor.detail({ id: accountId }, event.user, ctx.db);
        if (!account) return writeFailure(new NotFoundError("account", accountId));
      }

      // Check-then-write is serialized by a lock per schedule period; the rows
      // are read by the (tenantId, scheduleId, period) index, normally 0-2 of them.
      await ctx.db.advisoryXactLock(
        CONFIRM_PERIOD_LOCK_NAMESPACE,
        `${payload.scheduleId}:${payload.period}`,
      );
      const rows = await ctx.db.selectMany(transactionTable, {
        tenantId: event.user.tenantId,
        scheduleId: payload.scheduleId,
        period: payload.period,
      });
      const reversed = findReversedIds(
        rows.map((r) => ({
          reversesTransactionId:
            r["reversesTransactionId"] == null ? null : String(r["reversesTransactionId"]),
        })),
      );
      const active = rows.find(
        (r) => r["reversesTransactionId"] == null && !reversed.has(String(r["id"])),
      );
      if (active) {
        const ok: WriteResult<{ id: string; alreadyBooked: true }> = {
          isSuccess: true,
          data: { id: String(active["id"]), alreadyBooked: true },
        };
        return ok;
      }

      const amount = payload.amount ?? Number(schedule["amount"]);
      // The subject is a property of the schedule, not the confirm call — a
      // period without one stays without one, no backfill/error.
      const { subjectType, subjectId } = readSubjectReference(schedule);
      const created = await transactionExecutor.create(
        {
          id: generateId(),
          date: payload.date ?? `${payload.period}-01`,
          description: String(schedule["description"]),
          reference: null,
          scheduleId: payload.scheduleId,
          period: payload.period,
          reversesTransactionId: null,
          status: "posted",
          lines: [
            { accountId: debitAccountId, amount },
            { accountId: creditAccountId, amount: -amount },
          ],
          subjectType,
          subjectId,
        },
        event.user,
        ctx.db,
      );
      // Same shape as the idempotent-path return above (684/6) — a caller
      // shouldn't have to check "does alreadyBooked exist" to know which
      // branch fired.
      if (!created.isSuccess) return created;
      return {
        isSuccess: true,
        data: { ...created.data, alreadyBooked: false as const },
      };
    },
  });
}

export const confirmSchedulePeriodHandler = createConfirmSchedulePeriodHandler();
