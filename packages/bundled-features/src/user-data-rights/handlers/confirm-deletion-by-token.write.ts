import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { UnprocessableError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import { z } from "zod";
import { USER_STATUS } from "../../user";
import { verifyDeletionToken } from "../deletion-token";
import { startDeletionGracePeriod } from "./deletion-grace-period";

export type ConfirmDeletionByTokenOptions = {
  readonly deletionTokenSecret?: string;
};

// Generischer 422 für jeden Token-Fehlerpfad (malformed / bad_signature /
// expired / kein Secret) — kein Signal ob ein Token zu einem User gehört.
function invalidToken(): UnprocessableError {
  return new UnprocessableError("invalid_or_expired_token", {
    details: { reason: "invalid_or_expired_token" },
  });
}

// Anonymer Apex-Flow Schritt 2: Verify-Link-Target. Verifiziert das
// HMAC-Token, extrahiert die userId und startet die Grace-Period über die
// geteilte Logik.
//
// Idempotenz ist NUR bounded: ein zweites Confirm auf einen noch-pending
// (DeletionRequested) User trifft non-active → cannot_process_deletion. ABER
// nach einem cancel-deletion (status → Active, gracePeriodEnd → null) ist der
// User wieder aktiv; ein noch-gültiges Token (TTL aus request-deletion-by-email)
// re-armt dann eine zweite Grace-Period (replay-after-cancel). Das Risiko ist
// durch die Token-TTL begrenzt; der vollständige Fix (requestId pro Request im
// Token + auf der User-Row, vom cancel genullt) ist als review-finding #354/1
// deferred — er braucht eine Migration der geteilten user-Entity.
export function createConfirmDeletionByTokenHandler(opts: ConfirmDeletionByTokenOptions = {}) {
  return defineWriteHandler({
    name: "confirm-deletion-by-token",
    schema: z.object({ token: z.string().min(1) }),
    access: { roles: ["anonymous", "Member", "User", "TenantAdmin", "SystemAdmin"] },
    rateLimit: { per: "ip", limit: 10, windowSeconds: 60 },
    handler: async (event, ctx) => {
      if (!opts.deletionTokenSecret) return writeFailure(invalidToken());

      const verified = verifyDeletionToken(event.payload.token, opts.deletionTokenSecret);
      if (!verified.ok) return writeFailure(invalidToken());

      const res = await startDeletionGracePeriod(ctx, verified.userId, event.user.tenantId);
      if (!res.ok) {
        // Generischer 422 statt res.error: dieser Endpoint ist anonym-öffentlich,
        // res.error trägt den konkreten User-Status (currentStatus aus
        // user_not_in_active_state) und würde einem Token-Inhaber das Proben des
        // Account-Status erlauben (#354/2). Der authentifizierte request-deletion-
        // Pfad zeigt dem User legitim seinen eigenen Status.
        return writeFailure(
          new UnprocessableError("cannot_process_deletion", {
            details: { reason: "cannot_process_deletion" },
          }),
        );
      }

      return {
        isSuccess: true as const,
        data: {
          status: USER_STATUS.DeletionRequested,
          gracePeriodEnd: res.gracePeriodEnd.toString(),
        },
      };
    },
  });
}
