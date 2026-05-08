import {
  addDurationSpec,
  type DurationSpec,
  describeDurationSpec,
} from "@cosmicdrift/kumiko-framework/compliance";
import { createSystemUser, defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { UnprocessableError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { USER_STATUS, userTable } from "../../user";

// POST /api/user/request-deletion (S2.U5).
//
// User triggert seinen eigenen Forget-Antrag. Setzt:
//   - status = "deletionRequested" → Auth-Middleware blockt schreib-API
//     (S2.U6)
//   - gracePeriodEnd = now + Compliance-Profile.userRights.gracePeriod
//     (eu-dsgvo: 30d, swiss-dsg: 30d, de-hr-dsgvo-hgb: 30d).
//
// Cron-Job (run-forget-cleanup) checkt taeglich abgelaufene Grace-
// Periods und triggert dann die Hook-Iteration.
//
// Idempotent: zweiter Call ueberschreibt gracePeriodEnd nicht (waere
// "Reset" der Frist) — wirft 422 mit klarer Begründung. User muss
// erst cancel-deletion + neu request.
//
// **Cross-Tenant-Semantik (Account-weite Loeschung):**
// User-Entity ist tenant-agnostisch (1 User, n Tenants via
// tenantMembership). `status`/`gracePeriodEnd` sind globale Spalten am
// User-Row, kein per-Membership-State. Folge: ein request-deletion in
// Tenant A flippt den User-Row global — alle Tenants sehen Alice als
// `deletionRequested`. Das ist Absicht und entspricht dem Geist von
// DSGVO Art. 17: Loesche-mich ist personen-bezogen, nicht mandant-
// bezogen, und der Plattform-Operator ist Verantwortlicher fuer alle
// Verarbeitungen ueber alle Tenants hinweg.
//
// Wer nur einen einzelnen Tenant verlassen will (User bleibt in anderen
// aktiv), nutzt einen `leave-tenant`-Endpoint — das ist NICHT der
// Forget-Pfad und gehoert in die tenant-Membership-Domain.
//
// Fuer den Cleanup-Runner (S2.U5b) bedeutet das: pro EXT_USER_DATA-Hook
// muss ueber alle Memberships von `userId` iteriert werden, nicht nur
// ueber den Tenant in dem der Antrag gestellt wurde.
export const requestDeletionWrite = defineWriteHandler({
  name: "request-deletion",
  schema: z.object({}),
  access: { openToAll: true },
  handler: async (event, ctx) => {
    // ctx.db.raw (kein TenantDb-Wrapper) weil User-Entity tenant-agnostisch
    // ist: Der `tenant_id`-DB-Default-Wert auf der User-Row ist nur die
    // Initial-Erstellungs-Tenant; ein Forget-Antrag aus Tenant B muss
    // dieselbe Row global finden + flippen, sonst leakt sich der Antrag
    // nicht ueber Tenant-Grenzen (siehe Cross-Tenant-Test).
    const userRow = await ctx.db.raw
      .select({ status: userTable["status"] })
      .from(userTable)
      .where(eq(userTable["id"], event.user.id))
      .limit(1);

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

    // Compliance-Profile fuer gracePeriod via Cross-Feature-Query. Pattern:
    // ctx.queryAs(user, qn, payload) — siehe auth-email-password/change-
    // password.write.ts. @cast-boundary engine-bridge — queryAs liefert
    // unknown, narrow auf den effektiven Profile-Shape.
    const profile = (await ctx.queryAs(
      createSystemUser(event.user.tenantId),
      "compliance-profiles:query:for-tenant",
      {},
    )) as { profile: { userRights: { gracePeriod: DurationSpec } } };

    const gracePeriod = profile.profile.userRights.gracePeriod;
    // addDurationSpec rendert sowohl `{days}` als auch `{hours}` korrekt
    // — vorher fiel ein `{hours: 6}`-Override stillschweigend auf
    // 30-day-Default zurueck (Bug aus advisor-Review S2.U5a).
    //
    // App-Server-Clock ist authoritative (Toleranz vs. DB-now() liegt im
    // ms-Bereich, irrelevant fuer Grace-Periods >= 6h). Bonus: instant()
    // customType nimmt Temporal.Instant direkt — kein SQL-interval-
    // Fragment-Bypass des Codecs.
    const T = getTemporal();
    const gracePeriodEnd = addDurationSpec(T.Now.instant(), gracePeriod);

    // Update via raw-db (tenant-agnostisch wie der lookup oben).
    await ctx.db.raw
      .update(userTable)
      .set({
        status: USER_STATUS.DeletionRequested,
        gracePeriodEnd,
      })
      .where(eq(userTable["id"], event.user.id));

    return {
      isSuccess: true as const,
      data: {
        userId: event.user.id,
        status: USER_STATUS.DeletionRequested,
        gracePeriod,
        graceDescription: describeDurationSpec(gracePeriod),
      },
    };
  },
});
