import { fetchOne } from "@cosmicdrift/kumiko-framework/bun-db";
import { defineWriteHandler, type HandlerContext } from "@cosmicdrift/kumiko-framework/engine";
import { UnprocessableError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import { z } from "zod";
import { USER_STATUS, userTable } from "../../user";
import { peekDeletionTokenUserId, verifyDeletionToken } from "../deletion-token";
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

// userId stammt aus dem noch-unverifizierten Token (Angreifer-Eingabe). Ein
// fehlgeschlagener Lookup — z.B. eine typfremde id auf einer int/uuid-Spalte —
// darf nicht als 500 durchschlagen; null behandelt der Caller wie "kein offener
// Antrag" (generischer 422). Die HMAC-Prüfung bleibt der eigentliche Gate.
async function readPendingDeletionRequestId(
  ctx: HandlerContext,
  userId: string,
): Promise<string | null> {
  try {
    const row = await fetchOne<{ pendingDeletionRequestId: string | null }>(ctx.db.raw, userTable, {
      id: userId,
    });
    return row?.["pendingDeletionRequestId"] ?? null;
  } catch {
    return null;
  }
}

// Anonymer Apex-Flow Schritt 2: Verify-Link-Target. Verifiziert das
// HMAC-Token, extrahiert die userId und startet die Grace-Period über die
// geteilte Logik.
//
// Replay-Schutz (#354/1): die requestId der Row ist Teil des Verify-Keys. Wir
// lesen sie über die (unverifizierte, nur-Lookup) userId aus dem Token, lehnen
// einen fehlenden Eintrag ab und verifizieren das Token gegen die CURRENT
// requestId. Ein zweites Confirm auf einen noch-pending User trifft zudem
// non-active → cannot_process_deletion. Nach einem cancel-deletion (status →
// Active, pendingDeletionRequestId → null) schlägt ein nachgespieltes Token an
// der genullten/erneuerten requestId fehl — kein re-arm mehr.
export function createConfirmDeletionByTokenHandler(opts: ConfirmDeletionByTokenOptions = {}) {
  return defineWriteHandler({
    name: "confirm-deletion-by-token",
    schema: z.object({ token: z.string().min(1) }),
    access: { roles: ["anonymous", "Member", "User", "TenantAdmin", "SystemAdmin"] },
    rateLimit: { per: "ip", limit: 10, windowSeconds: 60 },
    handler: async (event, ctx) => {
      if (!opts.deletionTokenSecret) return writeFailure(invalidToken());

      const peekedUserId = peekDeletionTokenUserId(event.payload.token);
      if (!peekedUserId) return writeFailure(invalidToken());

      // Die requestId der Row ist Teil des Verify-Keys (HMAC-Purpose). Kein
      // offener Antrag (null) → das Token gehört zu einem abgebrochenen Zyklus
      // → Reject ohne weitere Signal-Preisgabe (gleicher generischer 422). Der
      // peekedUserId ist unverifizierte Angreifer-Eingabe — ein Lookup-Fehler
      // (z.B. typfremde id) wird zu demselben generischen 422, nie zu einem 500.
      const requestId = await readPendingDeletionRequestId(ctx, peekedUserId);
      if (!requestId) return writeFailure(invalidToken());

      const verified = verifyDeletionToken(
        event.payload.token,
        requestId,
        opts.deletionTokenSecret,
      );
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
