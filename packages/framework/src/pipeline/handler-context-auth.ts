import type { TenantId } from "../engine/types/identifiers.ts";
import type { MemberReader, SessionUser } from "../engine/types/index.ts";
import { INTERACTIVE_SIGN_IN_POLICY, resolveActiveMembershipFn } from "./active-membership.ts";
import { resolveAuthClaimsFn } from "./dispatch-shared.ts";
import type { HandlerContextScope } from "./handler-context-scope.ts";
import { createMemberReaderFn } from "./member-reader.ts";
import { createGatedMemberReader, systemIdentitySwitchDenied } from "./system-identity-switch.ts";

export function buildAuthFacet(scope: HandlerContextScope) {
  const { ctx, type, user, tx, hasIdentitySwitchGrant, identitySwitchAudit } = scope;
  const { effectiveFeatures } = ctx;
  // Lazy — creates the reader (which fails closed on SYSTEM_TENANT_ID) only
  // on first actual use, not on every HandlerContext build.
  let ungatedMemberReader: MemberReader | undefined;
  const queryAsMember = createGatedMemberReader(
    `handler "${type}"`,
    hasIdentitySwitchGrant,
    (userId, qn, payload) => {
      ungatedMemberReader ??= createMemberReaderFn(ctx, user.tenantId, tx);
      return ungatedMemberReader(userId, qn, payload);
    },
    { ...identitySwitchAudit, tenantId: user.tenantId },
  );
  return {
    // Thin pass-through: one resolve impl lives on the dispatcher, the
    // handler surface just forwards the call so both entry points (login
    // handler via ctx.resolveAuthClaims, switch-tenant route via
    // dispatcher.resolveAuthClaims) cannot drift.
    resolveAuthClaims: (claimsUser: SessionUser) => resolveAuthClaimsFn(ctx, claimsUser), // @wrapper-known semantic-alias

    // Thin pass-through, same reasoning as resolveAuthClaims above — one
    // resolve impl lives on the dispatcher so callers can't drift apart.
    // Internally queries memberships as SYSTEM, so it needs the same grant
    // as a SYSTEM queryAs/writeAs (r.systemScope() or escapeHatch).
    resolveActiveMembership: (userId: string, tenantId: TenantId) => {
      if (!hasIdentitySwitchGrant) throw systemIdentitySwitchDenied(`handler "${type}"`);
      return resolveActiveMembershipFn(ctx, userId, tenantId, INTERACTIVE_SIGN_IN_POLICY); // @wrapper-known semantic-alias
    },

    // Needs the same grant as a SYSTEM queryAs.
    queryAsMember,

    // Feature-effective check for in-handler opt-in logic. Scope:
    // **current user's tenant** — for cross-tenant lookups (rare,
    // SysAdmin operations) read effectiveFeatures(otherTenantId) directly.
    // When the feature-toggles or tier-engine feature isn't wired (no
    // effectiveFeatures callback), always returns true — apps without
    // tier-cuts treat all features on.
    //
    // Falls back to the live trialGate when the sync set says the feature
    // is off — the sync set never contains trial-tier features (time-
    // derived, can't boot-cache), so without this a trial tenant checking
    // a companion feature's toggle would silently read `false` even though
    // the dispatch gate already lets trial-tier handlers run.
    hasFeature: async (featureName: string): Promise<boolean> => {
      if (!effectiveFeatures) return true;
      if (effectiveFeatures(user.tenantId).has(featureName)) return true;
      if (!effectiveFeatures.trialGate) return false;
      return effectiveFeatures.trialGate(user.tenantId, featureName);
    },
  };
}
