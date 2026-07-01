import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import type {
  AccessRule,
  WriteHandlerDef,
  WriteResult,
} from "@cosmicdrift/kumiko-framework/engine";
import { NotFoundError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import { generateId } from "@cosmicdrift/kumiko-framework/utils";
import { DEFAULT_LEDGER_ACCESS } from "../constants";
import {
  accountExecutor,
  scheduleExecutor,
  transactionExecutor,
  transactionTable,
} from "../executor";
import { isoMonth, scheduleReference } from "../recurring";
import { type ConfirmSchedulePeriodPayload, confirmSchedulePeriodPayloadSchema } from "../schemas";

// confirm-schedule-period — turn ONE projected period of a schedule into a posted,
// balanced transaction (debit +amount / credit −amount), tagged with
// scheduleReference(scheduleId, period) so the host can merge Soll vs. Ist.
//
// Idempotent + reversal-aware: if an ACTIVE (non-reversed) booking for this
// reference already exists, it's a no-op; a booking that was reversed (Storno)
// leaves the period re-confirmable. Referential integrity (both accounts must
// exist) mirrors create-transaction — a schedule could name a bogus account, the
// generic CRUD create doesn't check.
export function createConfirmSchedulePeriodHandler(
  access: AccessRule = DEFAULT_LEDGER_ACCESS,
): WriteHandlerDef {
  return {
    name: "confirm-schedule-period",
    schema: confirmSchedulePeriodPayloadSchema,
    access,
    handler: async (event, ctx) => {
      const payload = event.payload as ConfirmSchedulePeriodPayload; // @cast-boundary engine-payload

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

      const reference = scheduleReference(payload.scheduleId, payload.period);

      // Scan this tenant's transactions (same full-tenant read the reports do) to
      // find an active booking for this reference. A tx is reversed when another
      // tx's reference names its id (the Storno mirror).
      // ponytail: read-then-write, so two confirms racing the same period could
      // double-book; add a unique index on (tenantId, reference) when concurrent
      // confirms become real.
      const txRows = await selectMany(ctx.db.raw, transactionTable, {
        tenantId: event.user.tenantId,
      });
      const txIds = new Set(txRows.map((r) => String(r["id"])));
      const reversedTxIds = new Set(
        txRows
          .filter((r) => r["reference"] != null && txIds.has(String(r["reference"])))
          .map((r) => String(r["reference"])),
      );
      const active = txRows.find(
        (r) => r["reference"] === reference && !reversedTxIds.has(String(r["id"])),
      );
      if (active) {
        const ok: WriteResult<{ id: string; alreadyBooked: true }> = {
          isSuccess: true,
          data: { id: String(active["id"]), alreadyBooked: true },
        };
        return ok;
      }

      const amount = payload.amount ?? Number(schedule["amount"]);
      return transactionExecutor.create(
        {
          id: generateId(),
          date: payload.date ?? `${payload.period}-01`,
          description: String(schedule["description"]),
          reference,
          status: "posted",
          lines: [
            { accountId: debitAccountId, amount },
            { accountId: creditAccountId, amount: -amount },
          ],
        },
        event.user,
        ctx.db,
      );
    },
  };
}

export const confirmSchedulePeriodHandler: WriteHandlerDef = createConfirmSchedulePeriodHandler();
