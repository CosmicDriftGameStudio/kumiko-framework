import { fetchOne } from "@cosmicdrift/kumiko-framework/bun-db";
import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { UnprocessableError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
// Value-only import, aliased to avoid shadowing the ambient global
// `Temporal` TYPE that the fetched row's gracePeriodEnd resolves against
// (same #1438 dual-package-hazard pattern as event-store.ts).
import { Temporal as TemporalPolyfill } from "temporal-polyfill";
import { z } from "zod";
import { USER_STATUS, userTable } from "../../user";
import { updateUserLifecycle } from "../lib/update-user-lifecycle";

// kumiko-framework#1525: exported so the ambient-global-independence
// regression test can call it directly — the handler itself has no seam
// short of a full dispatcher round-trip (which would also delete the
// ambient global out from under buildHandlerContext's unrelated ctx.tz
// setup, unrelated to this fix).
export function isWithinGracePeriod(gracePeriodEnd: Temporal.Instant | null): boolean {
  // @cast-boundary temporal-polyfill-vs-ambient: same TC39 Temporal.Instant
  // at runtime — gracePeriodEnd is DB-row-typed against the ambient
  // global, two distinct nominal types across the two .d.ts sources (see
  // event-store.ts).
  return (
    gracePeriodEnd != null &&
    TemporalPolyfill.Instant.compare(
      gracePeriodEnd as unknown as InstanceType<typeof TemporalPolyfill.Instant>,
      TemporalPolyfill.Now.instant(),
    ) > 0
  );
}

// POST /api/user/cancel-deletion (S2.U5).
//
// Innerhalb der Grace-Period kann User seinen Forget-Antrag zurueck-
// nehmen. Setzt:
//   - status = "active"
//   - gracePeriodEnd = null
//
// Nach Grace-Period: 422 (run-forget-cleanup hat in der Zwischenzeit
// die Hooks schon getriggert — Reversal nicht moeglich).
//
// Sonderfall: Cancel als "active"-User → 422 (kein pending Forget).
export const cancelDeletionWrite = defineWriteHandler({
  name: "cancel-deletion",
  schema: z.object({}),
  access: { openToAll: true },
  handler: async (event, ctx) => {
    // ctx.db.raw (kein TenantDb-Wrapper) weil User-Entity tenant-agnostisch
    // ist — siehe request-deletion.write.ts fuer die Begruendung. Cancel
    // muss aus jedem Tenant-Mode den User finden + zuruecksetzen koennen.
    const row = await fetchOne<{
      status: string;
      gracePeriodEnd: Temporal.Instant | null;
    }>(ctx.db.raw, userTable, { id: event.user.id });

    if (!row) {
      return writeFailure(
        new UnprocessableError("user_not_found", {
          details: { reason: "user_not_found", userId: event.user.id },
        }),
      );
    }

    if (row.status !== USER_STATUS.DeletionRequested) {
      return writeFailure(
        new UnprocessableError("no_pending_deletion", {
          details: {
            reason: "no_pending_deletion",
            currentStatus: row.status,
          },
        }),
      );
    }

    if (!isWithinGracePeriod(row.gracePeriodEnd)) {
      return writeFailure(
        new UnprocessableError("grace_period_expired", {
          details: { reason: "grace_period_expired" },
        }),
      );
    }

    await updateUserLifecycle(ctx.db.raw, event.user.id, {
      status: USER_STATUS.Active,
      gracePeriodEnd: null,
      // #354/1: schließt das replay-after-cancel-Fenster — ein noch
      // TTL-gültiges email-Token verifiziert gegen die genullte requestId
      // nicht mehr und kann keine zweite Grace-Period armen.
      pendingDeletionRequestId: null,
    });

    // gracePeriodEnd=null im Response symmetrisch zu request-deletion's
    // ISO-Timestamp — Frontend kann beide Endpoints uniform behandeln.
    return {
      isSuccess: true as const,
      data: {
        userId: event.user.id,
        status: USER_STATUS.Active,
        gracePeriodEnd: null as string | null,
      },
    };
  },
});
