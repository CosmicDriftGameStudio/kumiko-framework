import { createTenantDb } from "@cosmicdrift/kumiko-framework/db";
import type { HandlerContext, TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { findUserMfaRow } from "./db/queries";
import { verifyMfaFactor } from "./verify-factor";

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
    const scopedDb = createTenantDb(ctx.db.raw, tenantId, "system");
    const row = await findUserMfaRow(scopedDb, { id: userId, tenantId, roles: [] });
    if (!row) return { enrolled: false, ok: false };
    // Fail closed without ctx.redis, matching disable.write.ts/verify.write.ts —
    // skipping the TOTP-replay burn would let an observed code be replayed.
    if (!code || !ctx.redis) return { enrolled: true, ok: false };
    const verify = await verifyMfaFactor(row, code, { redis: ctx.redis, userId });
    return { enrolled: true, ok: verify.ok && verify.method === "totp" };
  };
}
