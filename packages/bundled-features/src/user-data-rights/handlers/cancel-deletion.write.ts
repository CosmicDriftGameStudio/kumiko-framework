import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { UnprocessableError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import { eq, sql } from "drizzle-orm";
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
    //
    // Combined query: status + grace_period_end-vs-now in einem Pass.
    const checkRows = await ctx.db.raw
      .select({
        status: userTable["status"],
        inGrace: sql<boolean>`(${userTable["gracePeriodEnd"]} > now())`,
      })
      .from(userTable)
      .where(eq(userTable["id"], event.user.id))
      .limit(1);

    if (checkRows.length === 0) {
      return writeFailure(
        new UnprocessableError("user_not_found", {
          details: { reason: "user_not_found", userId: event.user.id },
        }),
      );
    }

    const row = checkRows[0];
    if (!row || row.status !== USER_STATUS.DeletionRequested) {
      return writeFailure(
        new UnprocessableError("no_pending_deletion", {
          details: {
            reason: "no_pending_deletion",
            currentStatus: row?.status,
          },
        }),
      );
    }

    if (!row.inGrace) {
      return writeFailure(
        new UnprocessableError("grace_period_expired", {
          details: { reason: "grace_period_expired" },
        }),
      );
    }

    await ctx.db.raw
      .update(userTable)
      .set({
        status: USER_STATUS.Active,
        gracePeriodEnd: null,
      })
      .where(eq(userTable["id"], event.user.id));

    return {
      isSuccess: true as const,
      data: {
        userId: event.user.id,
        status: USER_STATUS.Active,
      },
    };
  },
});
