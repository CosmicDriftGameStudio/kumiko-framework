import { createTransportForTenant } from "@cosmicdrift/kumiko-bundled-features/mail-foundation";
import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import { z } from "zod";
import { USER_STATUS } from "../../user";
import {
  type GdprMailDefaults,
  isMailTransportAvailable,
  makeDefaultDeletionRequestedEmail,
} from "../lib/default-mailers";
import { startDeletionGracePeriod } from "./deletion-grace-period";

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
  /** Stored user.locale (free-form) — lets the default mailer render in the
   *  recipient's language. */
  readonly userLocale: string | null;
  readonly tenantId: string;
  readonly gracePeriodEnd: string;
}) => Promise<void>;

export type RequestDeletionOptions = {
  readonly sendDeletionRequestedEmail?: SendDeletionRequestedEmailFn;
  /** Branding fuer die Default-Mail wenn kein sendDeletionRequestedEmail
   *  gesetzt ist + mail-foundation gemountet ist. */
  readonly mailDefaults?: GdprMailDefaults;
};

// POST /api/user/request-deletion (S2.U5a) — DSGVO Art. 17 Forget-Antrag.
// Flippt status=Active → deletionRequested, setzt gracePeriodEnd aus dem
// Compliance-Profile (geteilte Logik: startDeletionGracePeriod). Account-
// weite Semantik (1 User-Row global), siehe docs/plans/architecture/
// user-data-rights.md "Cross-Tenant-Semantik".
export function createRequestDeletionHandler(opts: RequestDeletionOptions = {}) {
  return defineWriteHandler({
    name: "request-deletion",
    schema: z.object({}),
    access: { openToAll: true },
    handler: async (event, ctx) => {
      const res = await startDeletionGracePeriod(ctx, event.user.id, event.user.tenantId);
      if (!res.ok) return writeFailure(res.error);
      const { gracePeriodEnd, userEmail, userLocale } = res;

      // App-Callback hat Vorrang; sonst greift die mail-foundation-Default-Mail
      // (Request-Lane → ctx.config vorhanden, createTransportForTenant direkt).
      // Ohne gemounteten mail-transport bleibt send undefined → keine Mail.
      const send =
        opts.sendDeletionRequestedEmail ??
        (isMailTransportAvailable(ctx.registry)
          ? makeDefaultDeletionRequestedEmail(
              (tenantId) =>
                createTransportForTenant(ctx, tenantId, "user-data-rights:request-deletion"),
              opts.mailDefaults,
            )
          : undefined);

      // Best-effort Email-Notification. Send-Failure darf das Write nicht
      // killen — siehe Type-Doc oben.
      if (send && userEmail.length > 0) {
        try {
          await send({
            userId: event.user.id,
            userEmail,
            userLocale,
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
      // Frontend/Audit/Cleanup-Runner alle denselben Wert lesen.
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
