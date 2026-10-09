import { acquireNamespacedAdvisoryLock } from "@cosmicdrift/kumiko-framework/db";
import type {
  AccessRule,
  WriteHandlerDef,
  WriteResult,
} from "@cosmicdrift/kumiko-framework/engine";
import { NotFoundError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import { generateId } from "@cosmicdrift/kumiko-framework/utils";
import { DEFAULT_LEDGER_ACCESS } from "../constants.js";
import {
  accountExecutor,
  scheduleExecutor,
  transactionExecutor,
  transactionTable,
} from "../executor.js";
import { findReversedIds, isoMonth, scheduleReference } from "../recurring.js";
import {
  type ConfirmSchedulePeriodPayload,
  confirmSchedulePeriodPayloadSchema,
} from "../schemas.js";
import { readSubjectReference } from "../subject-reference.js";

// pg_advisory_xact_lock namespace (int4): 'lcsp' as ASCII, disjoint from the
// framework's other fixed advisory-lock keys.
const CONFIRM_PERIOD_LOCK_NAMESPACE = 0x6c637370;
const CONFIRM_PERIOD_LOCK_REASON =
  "takes the per-(tenant, reference) advisory lock so parallel confirms cannot both pass the already-booked check; TenantDb has no lock API";

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
    escapeHatch: { grants: ["unsafeRaw"], reason: CONFIRM_PERIOD_LOCK_REASON },
    description:
      "Turns one month of a recurring schedule into a posted balanced entry between its debit and credit account, returning the existing booking instead when that period is already booked and not reversed; use it to move a forecast period into the actual books.",
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

      // Two targeted reads instead of a full-tenant transaction scan: (1) any
      // booking that already carries this exact schedule-period reference —
      // normally 0 or 1 row, never O(tenant's-full-history); (2) any Storno
      // that mirrors one of those candidates (a tx is reversed when ANOTHER
      // tx's `reference` names its id).
      // No unique index on (tenantId, reference): a Storno makes re-confirming the
      // same reference legitimate, so the check-then-write is serialized by a lock.
      await acquireNamespacedAdvisoryLock(
        ctx.db.unsafeRaw(),
        CONFIRM_PERIOD_LOCK_NAMESPACE,
        `${event.user.tenantId}:${reference}`,
      );
      const candidates = await ctx.db.selectMany(transactionTable, {
        tenantId: event.user.tenantId,
        reference,
      });
      const candidateIds = candidates.map((r) => String(r["id"]));
      const stornos =
        candidateIds.length > 0
          ? await ctx.db.selectMany(transactionTable, {
              tenantId: event.user.tenantId,
              reference: { in: candidateIds },
            })
          : [];
      const reversedIds = findReversedIds(
        [...candidates, ...stornos].map((r) => ({
          id: String(r["id"]),
          reference: r["reference"] === null ? null : String(r["reference"]),
        })),
      );
      const active = candidates.find((r) => !reversedIds.has(String(r["id"])));
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
          reference,
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
  };
}

export const confirmSchedulePeriodHandler: WriteHandlerDef = createConfirmSchedulePeriodHandler();
