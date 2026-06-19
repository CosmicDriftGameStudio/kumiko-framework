import { fetchOne, updateMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { UnprocessableError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import { z } from "zod";
import { USER_STATUS, userTable } from "../../user";

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
    const row = await fetchOne<{ status: string; gracePeriodEnd: Temporal.Instant | null }>(
      ctx.db.raw,
      userTable,
      { id: event.user.id },
    );

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

    const gracePeriodEnd = row.gracePeriodEnd;
    const inGrace =
      gracePeriodEnd != null &&
      Temporal.Instant.compare(gracePeriodEnd, Temporal.Now.instant()) > 0;

    if (!inGrace) {
      return writeFailure(
        new UnprocessableError("grace_period_expired", {
          details: { reason: "grace_period_expired" },
        }),
      );
    }

    await updateMany(
      ctx.db.raw,
      userTable,
      {
        status: USER_STATUS.Active,
        gracePeriodEnd: null,
        // #354/1: schließt das replay-after-cancel-Fenster — ein noch
        // TTL-gültiges email-Token verifiziert gegen die genullte requestId
        // nicht mehr und kann keine zweite Grace-Period armen.
        pendingDeletionRequestId: null,
      },
      { id: event.user.id },
    );

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
