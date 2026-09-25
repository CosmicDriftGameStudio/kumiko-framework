// tenant-handover's implementation of the shared signup-handover extension
// point (kumiko-framework#3035 follow-up, offlot-app#454): lets
// auth-email-password's signup-request verify a grant against its root row
// WITHOUT spending the anchor (the anchor is spent once, by the claim
// signup-confirm runs afterwards, via a fresh short-lived grant this module
// mints) — see shared/signup-handover.ts for the extension contract and
// grant.ts for the row-bound-grant mechanics being verified.

import type { SignupHandoverBinding, SignupHandoverProvider } from "../shared";
import { redeemRowBoundGrant } from "../shared";
import { TENANT_HANDOVER_CLAIM_WRITE_QN } from "./events";
import { signTenantHandoverGrant, tenantHandoverPurpose } from "./grant";
import { resolveRootAnchorLocation } from "./root-anchor";

const MINTED_CLAIM_GRANT_TTL_MINUTES = 5;

export function createSignupHandoverProvider(opts: {
  readonly grantSecret?: string;
}): SignupHandoverProvider {
  return {
    verifyGrant: async ({ db, registry, entityType, token }) => {
      const rootLocation = resolveRootAnchorLocation(registry, db, entityType);
      if (!rootLocation) return null;

      let sourceTenantId: string | undefined;
      const redeemed = await redeemRowBoundGrant({
        token,
        purpose: tenantHandoverPurpose(entityType),
        secret: opts.grantSecret,
        loadAnchor: async (rowId) => {
          const anchor = await rootLocation.loadAnchor(rowId);
          sourceTenantId = anchor ?? undefined;
          return anchor;
        },
        // Verify-only at signup-request; the anchor is spent by the claim
        // that signup-confirm runs.
        commitAnchor: { unsafeSkip: { reason: "signup_handover_verify_only" } },
      });
      if (!redeemed.ok || sourceTenantId === undefined) return null;

      return { entityType, rowId: redeemed.subject, sourceTenantId };
    },
    mintClaim: (binding: SignupHandoverBinding) => {
      // verifyGrant is fail-closed without a secret (redeemRowBoundGrant),
      // so a binding only ever exists here when opts.grantSecret was set.
      if (!opts.grantSecret) {
        throw new Error("tenant-handover signup-handover: mintClaim called without grantSecret");
      }
      const { token } = signTenantHandoverGrant({
        entityType: binding.entityType,
        rowId: binding.rowId,
        sourceTenantId: binding.sourceTenantId,
        ttlMinutes: MINTED_CLAIM_GRANT_TTL_MINUTES,
        secret: opts.grantSecret,
      });
      return {
        qualifiedName: TENANT_HANDOVER_CLAIM_WRITE_QN,
        payload: { token, entityType: binding.entityType },
      };
    },
  };
}
