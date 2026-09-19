// Email-verified account deletion, expressed as a row-bound grant: the
// subject is the user, the anchor is the pending request id stored on the
// user row. Minting and verification both run through
// shared/row-bound-grant, so a token from a cancelled cycle (id nulled) or a
// superseded one (row holds a newer id) fails verification — see #354/1.
//
// The purpose string and the anchoring are unchanged from the hand-rolled
// version this replaced, so tokens stay byte-compatible.

import type { Temporal } from "temporal-polyfill";
import { type RowBoundGrantResult, redeemRowBoundGrant, signRowBoundGrant } from "../shared";

const DELETION_REQUEST_PURPOSE = "deletion-request";

export function signDeletionToken(
  userId: string,
  requestId: string,
  ttlMinutes: number,
  secret: string,
  now?: Temporal.Instant,
): { readonly token: string; readonly expiresAt: Temporal.Instant } {
  return signRowBoundGrant({
    subject: userId,
    purpose: DELETION_REQUEST_PURPOSE,
    anchor: requestId,
    ttlMinutes,
    secret,
    now,
  });
}

export function redeemDeletionToken(args: {
  readonly token: string;
  readonly secret: string | undefined;
  readonly loadPendingRequestId: (userId: string) => Promise<string | null>;
  // Spends the anchor AND performs the actual lifecycle transition in one
  // atomic step (#3024) — the caller (confirm-deletion-by-token) folds the
  // Active→DeletionRequested write itself in here via `updateUserLifecycle`'s
  // `expect: { status: Active, pendingDeletionRequestId }`, so a write issued
  // after `ok: true` can't lose its work to a crash while the grant is
  // already burned (see shared/row-bound-grant.ts). Returns whether this
  // caller was the one who moved the row on.
  readonly commitDeletion: (userId: string, requestId: string) => Promise<boolean>;
  readonly now?: Temporal.Instant;
}): Promise<RowBoundGrantResult> {
  return redeemRowBoundGrant({
    token: args.token,
    purpose: DELETION_REQUEST_PURPOSE,
    secret: args.secret,
    loadAnchor: args.loadPendingRequestId,
    commitAnchor: args.commitDeletion,
    now: args.now,
  });
}
