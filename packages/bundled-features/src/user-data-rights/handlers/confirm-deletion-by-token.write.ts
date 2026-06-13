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
// geteilte Logik. Idempotent: ein zweites Confirm trifft auf den bereits
// geflippten (non-active) User → user_not_in_active_state, kein Schaden.
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
      if (!res.ok) return writeFailure(res.error);

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
