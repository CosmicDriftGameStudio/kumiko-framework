// Email-verified account deletion, expressed as a row-bound grant: the
// subject is the user, the anchor is the pending request id stored on the
// user row. Minting and verification both run through
// shared/row-bound-grant, so a token from a cancelled cycle (id nulled) or a
// superseded one (row holds a newer id) fails verification — see #354/1.
//
// The purpose string and the anchoring are unchanged from the hand-rolled
// version this replaced, so tokens stay byte-compatible.

import type { Temporal } from "temporal-polyfill";
import {
  type RowBoundGrantResult,
  redeemRowBoundGrant,
  signRowBoundGrant,
} from "../shared/row-bound-grant";

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
  readonly now?: Temporal.Instant;
}): Promise<RowBoundGrantResult> {
  return redeemRowBoundGrant({
    token: args.token,
    purpose: DELETION_REQUEST_PURPOSE,
    secret: args.secret,
    loadAnchor: args.loadPendingRequestId,
    now: args.now,
  });
}
