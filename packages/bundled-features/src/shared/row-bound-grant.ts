// A short-lived grant that lets a caller without a session perform exactly
// one named operation on exactly one row — the shape behind
// user-data-rights' confirm-deletion-by-token and any "you just created this
// row, now enrich it" flow.
//
// The row's own anchor (a value that moves on when the row is consumed: a
// request id, a status, a version) is mixed INTO the HMAC purpose rather
// than carried in the token. Verification recomputes it from the row's
// CURRENT anchor, so a replayed token dies the moment the row moves on —
// single-use semantics without a burn key or Redis. Minting and redeeming
// share one purpose-building function so the two can't drift apart; that
// coupling is the whole point of this module, since an unanchored purpose
// silently degrades to a bearer token valid for the full TTL.
//
// Anchoring alone closes the replay window only AFTER the row has moved on.
// Two requests redeeming the same grant simultaneously both read the live
// anchor and both verify, so spending it is a separate, mandatory step:
// `commitAnchor` must move the row on atomically (a conditional update on
// the anchor) and report whether this caller was the one who did. Skipping
// it is possible but has to be declared with a reason, the way the framework
// handles escapeHatch — an undeclared skip is how a single-use grant quietly
// becomes a bearer token for the length of its TTL. Put the actual write into
// the same statement that spends the anchor: a write issued after `ok: true`
// can lose its work to a crash while the grant is already burned.
//
// The subject is NOT secret: signToken puts it in the token body in the
// clear. A grant on a row therefore exposes that row's id to whoever holds
// the link. Where the id itself must stay hidden, use an opaque handle
// (single-use-token-store) instead.

import type { Temporal } from "temporal-polyfill";
import { peekTokenSubject, signToken, verifyToken } from "./signed-token";

export type RowBoundGrantResult =
  | { readonly ok: true; readonly subject: string; readonly expiresAtMs: number }
  | { readonly ok: false };

// Atomically spends the anchor: must return true only for the single caller
// that moved the row on from `expectedAnchor`, false for everyone else. A
// plain "read, check, then write" is not enough — two requests redeeming the
// same grant at once both read the live anchor and both pass.
export type AnchorCommit =
  | ((subject: string, expectedAnchor: string) => Promise<boolean>)
  | { readonly unsafeSkip: { readonly reason: string } };

const FAILED: RowBoundGrantResult = { ok: false };

function anchoredPurpose(purpose: string, anchor: string): string {
  return `${purpose}:${anchor}`;
}

export function signRowBoundGrant(args: {
  readonly subject: string;
  readonly purpose: string;
  readonly anchor: string;
  readonly ttlMinutes: number;
  readonly secret: string;
  readonly now?: Temporal.Instant;
}): { readonly token: string; readonly expiresAt: Temporal.Instant } {
  return signToken(
    args.subject,
    anchoredPurpose(args.purpose, args.anchor),
    args.ttlMinutes,
    args.secret,
    args.now,
  );
}

// Every rejection returns the same bare `{ ok: false }` — no reason, by
// design. A caller that could tell "bad signature" from "no such row" would
// hand an attacker a row-existence oracle on an endpoint that is open to
// anonymous callers.
export async function redeemRowBoundGrant(args: {
  readonly token: string;
  readonly purpose: string;
  readonly secret: string | undefined;
  readonly loadAnchor: (subject: string) => Promise<string | null>;
  readonly commitAnchor: AnchorCommit;
  readonly now?: Temporal.Instant;
}): Promise<RowBoundGrantResult> {
  if (!args.secret) return FAILED;

  const subject = peekTokenSubject(args.token);
  if (!subject) return FAILED;

  // The subject is unverified attacker input at this point, so a lookup that
  // throws on it (e.g. a non-uuid value against a uuid column) must not
  // surface as a 500.
  let anchor: string | null;
  try {
    anchor = await args.loadAnchor(subject);
  } catch {
    return FAILED;
  }
  if (!anchor) return FAILED;

  const verified = verifyToken(
    args.token,
    anchoredPurpose(args.purpose, anchor),
    args.secret,
    args.now,
  );
  if (!verified.ok) return FAILED;

  // Spending happens after verification, never before: a caller that burned
  // the anchor on an unverified token could invalidate any row it can name.
  if (typeof args.commitAnchor === "function") {
    const spent = await args.commitAnchor(subject, anchor);
    if (!spent) return FAILED;
  } else if (!args.commitAnchor.unsafeSkip.reason.trim()) {
    throw new Error("row-bound grant: unsafeSkip needs a non-empty reason");
  }

  return { ok: true, subject, expiresAtMs: verified.expiresAtMs };
}
