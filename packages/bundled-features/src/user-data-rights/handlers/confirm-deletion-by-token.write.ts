import type { DurationSpec } from "@cosmicdrift/kumiko-framework/compliance";
import {
  createSystemUser,
  defineWriteHandler,
  type HandlerContext,
} from "@cosmicdrift/kumiko-framework/engine";
import { UnprocessableError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import { z } from "zod";
import { USER_STATUS, userTable } from "../../user";
import { redeemDeletionToken } from "../deletion-token";
import { startDeletionGracePeriod } from "./deletion-grace-period";

export type ConfirmDeletionByTokenOptions = {
  readonly deletionTokenSecret?: string;
};

// Generischer 422 für jeden Token-Fehlerpfad (malformed / bad_signature /
// expired / kein Secret) — kein Signal ob ein Token zu einem User gehört.
function invalidToken(): UnprocessableError {
  return new UnprocessableError("invalid_or_expired_token");
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
    const row = await ctx.db
      .global(userTable)
      .fetchOne<{ pendingDeletionRequestId: string | null }>({
        id: userId,
      });
    return row?.["pendingDeletionRequestId"] ?? null;
  } catch {
    return null;
  }
}

// Anonymer Apex-Flow Schritt 2: Verify-Link-Target. Verifiziert das
// HMAC-Token, extrahiert die userId und flippt die Grace-Period über die
// geteilte Logik — in EINEM atomaren Schritt mit dem Anker-Spend (#3024):
// commitDeletion trägt die eigentliche Grace-Period-Transition, damit ein
// Absturz nach dem Spend nicht mehr den Schreibschritt verlieren kann.
//
// Replay-Schutz (#354/1): die requestId der Row ist Teil des Verify-Keys. Wir
// lesen sie über die (unverifizierte, nur-Lookup) userId aus dem Token, lehnen
// einen fehlenden Eintrag ab und verifizieren das Token gegen die CURRENT
// requestId. Nach einem cancel-deletion (status → Active, pendingDeletion-
// RequestId → null) schlägt ein nachgespieltes Token an der genullten/
// erneuerten requestId fehl — kein re-arm mehr.
//
// Nebenläufigkeit (#3024): zwei gleichzeitige Confirms desselben Tokens lesen
// beide dieselbe requestId und verifizieren beide das HMAC — commitDeletion
// spendet den Anker UND schreibt die Transition atomar (expect: status===
// Active && pendingDeletionRequestId===requestId), sodass genau einer
// gewinnt. Der Verlierer bekommt denselben generischen 422 wie ein
// ungültiges Token — kein Status-Leak (#354/2).
export function createConfirmDeletionByTokenHandler(opts: ConfirmDeletionByTokenOptions = {}) {
  return defineWriteHandler({
    name: "confirm-deletion-by-token",
    schema: z.object({ token: z.string().min(1) }),
    access: { roles: ["anonymous", "Member", "User", "TenantAdmin", "SystemAdmin"] },
    escapeHatch: {
      reason:
        "startDeletionGracePeriod reads the tenant compliance profile via ctx.queryAs(SYSTEM, " +
        "...) to compute the grace period end — the anonymous token holder has no read access " +
        "to that tenant-config projection. It also appends the user lifecycle event on the " +
        "SYSTEM_TENANT_ID user stream.",
    },
    agent: { expose: false },
    rateLimit: { per: "ip", limit: 10, windowSeconds: 60 },
    handler: async (event, ctx) => {
      // @cast-boundary engine-payload — queryAs returns unknown, narrowed to
      // the compliance-profile shape.
      const profile = (await ctx.queryAs(
        createSystemUser(event.user.tenantId),
        "compliance-profiles:query:for-tenant",
        {},
      )) as { profile: { userRights: { gracePeriod: DurationSpec } } };

      let gracePeriodEndIso: string | undefined;

      // The row's requestId is part of the verify key, so a token from a
      // cancelled or superseded cycle fails. Every error path ends in the same
      // generic 422 — commitDeletion folding the grace-period write into the
      // anchor-spend means there's no separate res.ok branch left to leak a
      // concrete status through.
      const verified = await redeemDeletionToken({
        token: event.payload.token,
        secret: opts.deletionTokenSecret,
        loadPendingRequestId: (userId) => readPendingDeletionRequestId(ctx, userId),
        commitDeletion: async (userId, requestId) => {
          const res = await startDeletionGracePeriod(
            ctx,
            userId,
            profile.profile.userRights.gracePeriod,
            ctx.db.unsafeRaw(
              "appends the user lifecycle event on the SYSTEM_TENANT_ID user stream",
            ),
            { pendingDeletionRequestId: requestId },
          );
          if (!res.ok) return false;
          gracePeriodEndIso = res.gracePeriodEnd.toString();
          return true;
        },
      });
      if (!verified.ok || gracePeriodEndIso === undefined) return writeFailure(invalidToken());

      return {
        isSuccess: true as const,
        data: {
          status: USER_STATUS.DeletionRequested,
          gracePeriodEnd: gracePeriodEndIso,
        },
      };
    },
  });
}
