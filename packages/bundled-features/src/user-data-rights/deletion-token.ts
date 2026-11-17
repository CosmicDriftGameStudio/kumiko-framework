// Email-verified account deletion, expressed as a row-bound grant: the
// subject is the user, the anchor is the pending request id stored on the
// user row. Minting and verification both run through
// shared/row-bound-grant, so a token from a cancelled cycle (id nulled) or a
// superseded one (row holds a newer id) fails verification.

import type { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import {
  type RowBoundGrantResult,
  redeemRowBoundGrant,
  signRowBoundGrant,
} from "../shared/index.ts";

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
  // atomic step — the caller (confirm-deletion-by-token) folds the
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

const DELETION_CANCEL_PURPOSE = "deletion-cancel";

// The anchor must not contain ':' (row-bound-grant delimiter), so the ISO
// string is replaced by epoch milliseconds. Floored on both sides, so the
// microsecond-precision DB value and the nanosecond-precision Instant match.
export function deletionCancelAnchor(gracePeriodEnd: Temporal.Instant): string {
  return String(gracePeriodEnd.epochMilliseconds);
}

const MS_PER_MINUTE = 60_000;

export function signDeletionCancelToken(
  userId: string,
  gracePeriodEnd: Temporal.Instant,
  secret: string,
  now?: Temporal.Instant,
): { readonly token: string; readonly expiresAt: Temporal.Instant } {
  const nowMs = now?.epochMilliseconds ?? Date.now();
  const ttlMinutes = Math.max(
    1,
    Math.ceil((gracePeriodEnd.epochMilliseconds - nowMs) / MS_PER_MINUTE),
  );
  return signRowBoundGrant({
    subject: userId,
    purpose: DELETION_CANCEL_PURPOSE,
    anchor: deletionCancelAnchor(gracePeriodEnd),
    ttlMinutes,
    secret,
    now,
  });
}

export function redeemDeletionCancelToken(args: {
  readonly token: string;
  readonly secret: string | undefined;
  // Anchor of the user's pending deletion (see deletionCancelAnchor), null
  // when no deletion is pending — then every token fails.
  readonly loadPendingGracePeriodAnchor: (userId: string) => Promise<string | null>;
  // Cancels the deletion atomically with spending the anchor; returns whether
  // this caller was the one that moved the row back to active.
  readonly commitCancel: (userId: string, anchor: string) => Promise<boolean>;
  readonly now?: Temporal.Instant;
}): Promise<RowBoundGrantResult> {
  return redeemRowBoundGrant({
    token: args.token,
    purpose: DELETION_CANCEL_PURPOSE,
    secret: args.secret,
    loadAnchor: args.loadPendingGracePeriodAnchor,
    commitAnchor: args.commitCancel,
    now: args.now,
  });
}
