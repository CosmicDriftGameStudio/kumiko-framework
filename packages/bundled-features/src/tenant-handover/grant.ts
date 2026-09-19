// Try-before-signup ownership handover (kumiko-framework#3035), expressed as a
// row-bound grant: the subject is the transferred run's own row id, the
// anchor is the SOURCE tenant id it currently lives under. Redeeming the
// grant is the ownership change itself — the claim handler's commitAnchor
// moves the row's tenantId from the anchor to the caller's own tenant in the
// same conditional UPDATE that spends the anchor, so a replayed or raced
// token can never re-target a row that already moved.
//
// The subject is NOT secret (row-bound-grant.ts) — a grant on a run exposes
// its row id to whoever holds the token. That is only safe because this
// token never leaves the anonymous visitor's own browser: it must not be
// put in a URL, logged, or emailed. The run's own photos may show plates —
// the grant must stay exactly where the anonymous flow minted it.

import type { Temporal } from "temporal-polyfill";
import { signRowBoundGrant } from "../shared";

const HANDOVER_PURPOSE_PREFIX = "tenant-handover";

// Namespaced by entityType so a grant minted for one transferable entity can
// never be redeemed against another — the claim handler verifies against the
// SAME purpose it builds from the caller-supplied entityType.
export function tenantHandoverPurpose(entityType: string): string {
  return `${HANDOVER_PURPOSE_PREFIX}:${entityType}`;
}

export function signTenantHandoverGrant(args: {
  readonly entityType: string;
  readonly rowId: string;
  readonly sourceTenantId: string;
  readonly ttlMinutes: number;
  readonly secret: string;
  readonly now?: Temporal.Instant;
}): { readonly token: string; readonly expiresAt: Temporal.Instant } {
  return signRowBoundGrant({
    subject: args.rowId,
    purpose: tenantHandoverPurpose(args.entityType),
    anchor: args.sourceTenantId,
    ttlMinutes: args.ttlMinutes,
    secret: args.secret,
    now: args.now,
  });
}
