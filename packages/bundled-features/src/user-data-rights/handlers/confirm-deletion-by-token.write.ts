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

// Anonymous apex flow step 2: verify-link target. Verifies the HMAC token,
// extracts the userId, and flips the grace period through the shared logic —
// in ONE atomic step with the anchor spend (#3024): commitDeletion carries
// the actual grace-period transition, so a crash after the spend can no
// longer lose the write step.
//
// Replay protection (#354/1): the row's requestId is part of the verify key.
// We read it via the (unverified, lookup-only) userId from the token, reject
// a missing entry, and verify the token against the CURRENT requestId. After
// a cancel-deletion (status → Active, pendingDeletionRequestId → null), a
// replayed token fails against the nulled/renewed requestId — no re-arm.
//
// Concurrency (#3024): two simultaneous confirms of the same token both read
// the same requestId and both verify the HMAC — commitDeletion spends the
// anchor AND writes the transition atomically (expect: status===Active &&
// pendingDeletionRequestId===requestId), so exactly one wins. The loser gets
// the same generic 422 as an invalid token — no status leak (#354/2).
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
