import { fetchOne } from "@cosmicdrift/kumiko-framework/bun-db";
import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import { USER_STATUS, userTable } from "../../user";
import { signDeletionToken } from "../deletion-token";
import { updateUserLifecycle } from "../lib/update-user-lifecycle";

// TTL des Verify-Links. 60 min — lang genug für einen Mail-Roundtrip,
// kurz genug dass ein abgefangener Link nicht ewig gültig ist.
const DELETION_VERIFY_TTL_MINUTES = 60;

// Apex-Magic-Link-Versand für den anonymen Deletion-Request. Der Handler
// gibt den Link NICHT zurück (content-Enumeration-Safety) — er ruft den
// Callback direkt, analog sendDeletionRequestedEmail.
//
// WICHTIG (Timing-Oracle): Der Callback MUSS non-blocking sein (enqueue, z.B.
// delivery.notify / Job), NICHT synchron senden. Er läuft nur im
// existierenden-aktiven-User-Pfad; ein synchroner Send macht die
// Response-Latenz für reale Accounts messbar länger als für nicht-existente
// → Enumeration über Timing. Ein schnelles enqueue gleicht das praktisch aus.
// Vollständige Timing-Angleichung (immer äquivalente Arbeit) ist v1-Follow-up.
export type SendDeletionVerificationEmailFn = (args: {
  readonly email: string;
  readonly verifyUrl: string;
  readonly expiresAt: string;
}) => Promise<void>;

export type RequestDeletionByEmailOptions = {
  /** HMAC-Secret zum Signieren des Verify-Tokens. Ohne Secret ist der Flow
   *  deaktiviert (Handler antwortet still mit success, kein Link). */
  readonly deletionTokenSecret?: string;
  /** Basis-URL des Apex-Confirm-Screens, z.B.
   *  "https://app.example.com/delete-account/confirm". Der Handler hängt
   *  `?token=<token>` an. Ohne URL kein Link. */
  readonly deletionVerifyUrl?: string;
  readonly sendDeletionVerificationEmail?: SendDeletionVerificationEmailFn;
};

// URL-safe append: handles a base URL that already carries query params
// (`?lang=de` → `?lang=de&token=…`) instead of producing an invalid
// `?lang=de?token=…`. searchParams.set encodes the token.
export function buildDeletionVerifyUrl(base: string, token: string): string {
  const url = new URL(base);
  url.searchParams.set("token", token);
  return url.toString();
}

// Anonymer Apex-Flow Schritt 1: "Account-Löschung beantragen" per Email.
// DSGVO-relevant gerade wenn der User sich NICHT mehr einloggen kann
// (Lockout). Email → Magic-Link → confirm-deletion-by-token.
//
// Enumeration-safe (content): antwortet IMMER mit derselben success-Shape,
// egal ob die Email existiert, der User aktiv ist oder der Flow konfiguriert
// ist. Ein Link wird nur für einen existierenden, aktiven User generiert.
// Timing-Safety hängt am non-blocking Callback (siehe Type-Doc oben).
export function createRequestDeletionByEmailHandler(opts: RequestDeletionByEmailOptions = {}) {
  return defineWriteHandler({
    name: "request-deletion-by-email",
    schema: z.object({ email: z.email() }),
    access: { roles: ["anonymous", "Member", "User", "TenantAdmin", "SystemAdmin"] },
    // Defense-in-depth gegen Email-Probing auf dem anonymen Endpoint.
    rateLimit: { per: "ip", limit: 10, windowSeconds: 60 },
    handler: async (event, ctx) => {
      const success = { isSuccess: true as const, data: { kind: "requested" as const } };

      // not-configured-safe: ohne Secret/URL kein Link, aber gleiche Antwort.
      if (!opts.deletionTokenSecret || !opts.deletionVerifyUrl) return success;

      // userTable ist tenant-agnostisch (Account-weite Löschung) → ctx.db.raw.
      const userRow = await fetchOne<{ id: string; status: string; email: string }>(
        ctx.db.raw,
        userTable,
        { email: event.payload.email },
      );
      if (!userRow || userRow["status"] !== USER_STATUS.Active || !userRow["email"]) {
        return success;
      }

      // Replay-Schutz (#354/1): pro Antrag eine frische requestId, die auf der
      // user-Row landet und in die Token-HMAC-Purpose gefaltet wird. cancel
      // nullt sie → ein nach Cancel nachgespieltes Token verifiziert nicht mehr.
      const requestId = crypto.randomUUID();
      await updateUserLifecycle(ctx.db.raw, userRow["id"], {
        pendingDeletionRequestId: requestId,
      });

      const { token, expiresAt } = signDeletionToken(
        userRow["id"],
        requestId,
        DELETION_VERIFY_TTL_MINUTES,
        opts.deletionTokenSecret,
      );
      const verifyUrl = buildDeletionVerifyUrl(opts.deletionVerifyUrl, token);

      if (opts.sendDeletionVerificationEmail) {
        try {
          await opts.sendDeletionVerificationEmail({
            email: userRow["email"],
            verifyUrl,
            expiresAt: expiresAt.toString(),
          });
        } catch (err) {
          // biome-ignore lint/suspicious/noConsole: operator-visibility for email-send-failure
          console.warn(
            `[user-data-rights:request-deletion-by-email] send failed err=${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      return success;
    },
  });
}
