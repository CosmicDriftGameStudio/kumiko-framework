import { addDurationSpec, type DurationSpec } from "@cosmicdrift/kumiko-framework/compliance";
import { createSystemUser, defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { UnprocessableError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { USER_STATUS, userTable } from "../../user";

// Atom 5b — Email-Notification beim deletion-requested-flip. Pattern:
// password-reset-Callback aus auth-routes.ts. Best-effort — Throw beim
// Send wird gefangen + per console.warn geloggt, der Status-Flip selbst
// bleibt erfolgreich. Reasoning: user-Aktion ist abgeschlossen sobald
// die DB-Row geflipt ist; Email-Versand ist Beleg, keine Vorbedingung.
// Wenn Email broken ist soll der User nicht erneut "Account löschen"
// klicken muessen.
export type SendDeletionRequestedEmailFn = (args: {
  readonly userId: string;
  readonly userEmail: string;
  readonly tenantId: string;
  readonly gracePeriodEnd: string;
}) => Promise<void>;

export type RequestDeletionOptions = {
  readonly sendDeletionRequestedEmail?: SendDeletionRequestedEmailFn;
};

// POST /api/user/request-deletion (S2.U5a) — DSGVO Art. 17 Forget-Antrag.
// Flippt status=Active → deletionRequested, setzt gracePeriodEnd aus
// Compliance-Profile. Account-weite Semantik (1 User-Row global), siehe
// docs/plans/architecture/user-data-rights.md "Cross-Tenant-Semantik".
export function createRequestDeletionHandler(opts: RequestDeletionOptions = {}) {
  return defineWriteHandler({
    name: "request-deletion",
    schema: z.object({}),
    access: { openToAll: true },
    handler: async (event, ctx) => {
      // ctx.db.raw (kein TenantDb-Wrapper) weil User-Entity tenant-agnostisch
      // ist — siehe Plan-Doc Cross-Tenant-Section.
      const userRow = await ctx.db.raw
        .select({ status: userTable["status"], email: userTable["email"] })
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
      )) as { profile: { userRights: { gracePeriod: DurationSpec } } }; // @cast-boundary engine-payload

      // addDurationSpec deckt `{days}` und `{hours}` ab. App-Server-Clock
      // ist authoritative — instant() customType nimmt Temporal.Instant
      // direkt, kein SQL-interval-Bypass des Codecs.
      const gracePeriod = profile.profile.userRights.gracePeriod;
      const T = getTemporal();
      const gracePeriodEnd = addDurationSpec(T.Now.instant(), gracePeriod);

      await ctx.db.raw
        .update(userTable)
        .set({
          status: USER_STATUS.DeletionRequested,
          gracePeriodEnd,
        })
        .where(eq(userTable["id"], event.user.id));

      // Best-effort Email-Notification. Send-Failure darf das Write nicht
      // killen — siehe Type-Doc oben. console.warn ist die Operator-
      // Sichtbarkeit; defineWriteHandler-Context fuehrt aktuell keinen
      // structured-logger durch, Refactor-Kandidat wenn ctx.log threadet.
      const userEmail = userRow[0]?.email;
      if (opts.sendDeletionRequestedEmail && userEmail && userEmail.length > 0) {
        try {
          await opts.sendDeletionRequestedEmail({
            userId: event.user.id,
            userEmail,
            tenantId: event.user.tenantId,
            gracePeriodEnd: gracePeriodEnd.toString(),
          });
        } catch (err) {
          // biome-ignore lint/suspicious/noConsole: operator-visibility for email-send-failure
          console.warn(
            `[user-data-rights:request-deletion] sendDeletionRequestedEmail failed userId=${event.user.id} tenantId=${event.user.tenantId} err=${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      // Response liefert den absoluten gracePeriodEnd-Timestamp damit
      // Frontend/Audit/Cleanup-Runner alle denselben Wert lesen — nicht
      // den Input-`{days|hours}`, der ist Konfiguration nicht Result.
      return {
        isSuccess: true as const,
        data: {
          userId: event.user.id,
          status: USER_STATUS.DeletionRequested,
          gracePeriodEnd: gracePeriodEnd.toString(),
        },
      };
    },
  });
}
