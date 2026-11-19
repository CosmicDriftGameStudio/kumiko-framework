import {
  declareEscapeHatch,
  type HandlerContext,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import { createTenantDb } from "@cosmicdrift/kumiko-framework/internal/row-level-security";
import { findUserMfaRow } from "./db/queries.ts";
import { verifyTotpFactor } from "./verify-factor.ts";

export type MfaCodeVerifyResult = { readonly enrolled: boolean; readonly ok: boolean };

export type MfaCodeVerifier = (
  ctx: HandlerContext,
  userId: string,
  tenantId: TenantId,
  code: string | undefined,
) => Promise<MfaCodeVerifyResult>;

// Re-auth-only primitive (personal-access-tokens' currentPassword+mfaCode
// gate), distinct from login's mfaStatusChecker (enrollment/policy only, no
// code) and from verify.write.ts (full login-completion flow). TOTP-only —
// a recovery code accepted here without persisting single-use consumption
// (verify.write.ts's remainingHashes update) would become infinitely
// reusable, and a re-auth gate is not the account-recovery flow recovery
// codes exist for.
export function createMfaCodeVerifier(): MfaCodeVerifier {
  return async (ctx, userId, tenantId, code) => {
    declareEscapeHatch({
      reason:
        "reads the MFA enrollment of the user being re-authenticated on the caller's handler context; the calling handler has to grant unsafeRaw itself",
      grants: ["unsafeRaw"],
    });
    const scopedDb = createTenantDb({
      db: ctx.db.unsafeRawAllTenants(),
      tenantId,
      mode: "system",
      reason:
        "re-authentication reads the MFA enrollment of the user's own tenant, not the handler's dispatch tenant",
    });
    const row = await findUserMfaRow(scopedDb, { id: userId, tenantId, roles: [] });
    if (!row) return { enrolled: false, ok: false };
    // Fail closed without ctx.services.redis, matching disable.write.ts/verify.write.ts —
    // skipping the TOTP-replay burn would let an observed code be replayed.
    if (!code || !ctx.services.redis) return { enrolled: true, ok: false };
    const totp = await verifyTotpFactor(row, code, { redis: ctx.services.redis, userId });
    return { enrolled: true, ok: totp === "valid" };
  };
}
