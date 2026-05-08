import { defineWriteHandler, createSystemUser } from "@cosmicdrift/kumiko-framework/engine";
import { UnprocessableError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { USER_STATUS, userTable } from "../../user";

// POST /api/user/request-deletion (S2.U5).
//
// User triggert seinen eigenen Forget-Antrag. Setzt:
//   - status = "deletionRequested" → Auth-Middleware blockt schreib-API
//     (S2.U6)
//   - gracePeriodEnd = now + Compliance-Profile.userRights.gracePeriod
//     (eu-dsgvo: 30d, swiss-dsg: 30d, de-hr-dsgvo-hgb: 30d, ca-quebec-l25:
//     30d, hipaa: 30d, us-ccpa: 45d)
//
// Cron-Job (run-forget-cleanup) checkt taeglich abgelaufene Grace-
// Periods und triggert dann die Hook-Iteration.
//
// Idempotent: zweiter Call ueberschreibt gracePeriodEnd nicht (waere
// "Reset" der Frist) — wirft 422 mit klarer Begründung. User muss
// erst cancel-deletion + neu request.
export const requestDeletionWrite = defineWriteHandler({
  name: "request-deletion",
  schema: z.object({}),
  access: { openToAll: true },
  handler: async (event, ctx) => {
    // Aktuellen User-Status pruefen — erlaubt nur active → deletionRequested
    const userRow = (await ctx.db
      .select()
      .from(userTable)
      .where(eq(userTable["id"], event.user.id))
      .limit(1)) as Array<{ status: string }>;

    if (userRow.length === 0) {
      return writeFailure(
        new UnprocessableError("user_not_found", {
          details: { reason: "user_not_found", userId: event.user.id },
        }),
      );
    }

    if (userRow[0]?.status !== USER_STATUS.Active) {
      return writeFailure(
        new UnprocessableError("user_not_in_active_state", {
          details: {
            reason: "user_not_in_active_state",
            currentStatus: userRow[0]?.status,
          },
        }),
      );
    }

    // Compliance-Profile fuer gracePeriod via Cross-Feature-Query.
    // Pattern: ctx.queryAs(user, qn, payload) — siehe auth-email-password/
    // change-password.write.ts.
    const profile = (await ctx.queryAs(
      createSystemUser(event.user.tenantId),
      "compliance-profiles:query:for-tenant",
      {},
    )) as {
      profile: { userRights: { gracePeriod: { days?: number; hours?: number } } };
    };

    const grace = profile.profile.userRights.gracePeriod;
    const graceDays = "days" in grace && grace.days !== undefined ? grace.days : 30;

    await ctx.db
      .update(userTable)
      .set({
        status: USER_STATUS.DeletionRequested,
        gracePeriodEnd: sql`now() + (${graceDays} || ' days')::interval`,
      })
      .where(eq(userTable["id"], event.user.id));

    return {
      isSuccess: true as const,
      data: {
        userId: event.user.id,
        status: USER_STATUS.DeletionRequested,
        graceDays,
      },
    };
  },
});
