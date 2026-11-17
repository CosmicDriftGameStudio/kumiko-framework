// A short-lived grant that lets a caller without a session perform exactly
// one named operation on exactly one row, the shape behind user-data-rights'
// confirm-deletion-by-token and any "you just created this row, now enrich
// it" flow.
//
// Subject AND anchor sit signed in the token body. The signature is checked
// without the database (verifyRowBoundGrant); only a genuine token reaches the
// row lookup, where the row's current anchor is compared with the signed one.
// A forged token therefore reaches neither the database nor a tenant switch.
//
// The anchor (a value that moves on when the row is consumed) is not secret:
// single use comes from it moving on, not from nobody knowing it. It must be
// unique per cycle and never recur (request id, UUID, monotonic version): a
// status can return to an earlier value and revive an old grant (ABA replay).
// Once the row moved on, a replayed token dies at the anchor comparison, with
// no burn key or Redis.
//
// Comparing alone closes the replay window only AFTER the row has moved on.
// Two requests redeeming the same grant simultaneously both read the live
// anchor and both match, so spending it is a separate, mandatory step:
// `commitAnchor` must move the row on atomically (a conditional update on
// the anchor) and report whether this caller was the one who did. Skipping
// it is possible but has to be declared with a reason, the way the framework
// handles escapeHatch: an undeclared skip is how a single-use grant quietly
// becomes a bearer token for the length of its TTL. Put the actual write into
// the same statement that spends the anchor: a write issued after `ok: true`
// can lose its work to a crash while the grant is already burned.
//
// Subject and anchor are readable by anyone who holds the token. A grant on a
// row therefore exposes that row's id. Where the id itself must stay hidden,
// use an opaque handle (single-use-token-store) instead.

import { createFallbackLogger } from "@cosmicdrift/kumiko-framework/logging";
import type { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import { signToken, verifyToken } from "./signed-token.ts";

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

const log = createFallbackLogger("row-bound-grant");

export type VerifiedRowBoundGrant =
  | {
      readonly ok: true;
      readonly subject: string;
      readonly anchor: string;
      readonly expiresAtMs: number;
    }
  | { readonly ok: false };

const FAILED = { ok: false } as const;

const GRANT_PURPOSE_PREFIX = "row-bound-grant";
const BODY_SEPARATOR = ":";

// The prefix separates grants from plain signToken purposes (reset/verify/unlock) and from the
// format before the anchor moved into the token, so no foreign token passes as a grant.
function grantPurpose(purpose: string): string {
  return `${GRANT_PURPOSE_PREFIX}:${purpose}`;
}

// The HMAC input is `row-bound-grant:${purpose}:${subject}:${anchor}.${expiresAtMs}`. Subject and
// anchor are free of ":" and ".", so it splits unambiguously from the right. The purpose may keep
// colons (tenant-handover namespaces its purpose by entity type).
function hasDelimiter(value: string): boolean {
  return value.includes(":") || value.includes(".");
}

export function signRowBoundGrant(args: {
  readonly subject: string;
  readonly purpose: string;
  readonly anchor: string;
  readonly ttlMinutes: number;
  readonly secret: string;
  readonly now?: Temporal.Instant;
}): { readonly token: string; readonly expiresAt: Temporal.Instant } {
  if (hasDelimiter(args.anchor) || hasDelimiter(args.subject)) {
    throw new Error("row-bound grant: subject and anchor must not contain ':' or '.'");
  }
  return signToken(
    `${args.subject}${BODY_SEPARATOR}${args.anchor}`,
    grantPurpose(args.purpose),
    args.ttlMinutes,
    args.secret,
    args.now,
  );
}

// Checks signature and expiry without the database, so anonymous wrappers pick the tenant only
// after the check. The row's own anchor is compared later, in redeemRowBoundGrant.
export function verifyRowBoundGrant(args: {
  readonly token: string;
  readonly purpose: string;
  readonly secret: string | undefined;
  readonly now?: Temporal.Instant;
}): VerifiedRowBoundGrant {
  if (!args.secret) return FAILED;
  const verified = verifyToken(args.token, grantPurpose(args.purpose), args.secret, args.now);
  if (!verified.ok) return FAILED;
  const [subject, anchor, ...rest] = verified.userId.split(BODY_SEPARATOR);
  if (rest.length > 0 || !subject || !anchor) return FAILED;
  return { ok: true, subject, anchor, expiresAtMs: verified.expiresAtMs };
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
  // Misconfiguration must throw on every call, not only on the first valid redemption.
  if (typeof args.commitAnchor !== "function" && !args.commitAnchor.unsafeSkip.reason.trim()) {
    throw new Error("row-bound grant: unsafeSkip needs a non-empty reason");
  }
  const claimed = verifyRowBoundGrant({
    token: args.token,
    purpose: args.purpose,
    secret: args.secret,
    now: args.now,
  });
  if (!claimed.ok) return FAILED;

  let current: string | null;
  try {
    current = await args.loadAnchor(claimed.subject);
  } catch (error) {
    // Name/code only: the subject is signed here, but driver messages can still echo it.
    // Logged so an infrastructure outage doesn't look like an expired link.
    log.warn("row-bound grant anchor lookup failed", {
      errorName: error instanceof Error ? error.name : typeof error,
      code: error instanceof Error && "code" in error ? String(error.code) : undefined,
    });
    return FAILED;
  }
  if (current !== claimed.anchor) return FAILED;

  // Spending happens after verification, never before: a caller that burned
  // the anchor on an unverified token could invalidate any row it can name.
  if (typeof args.commitAnchor === "function") {
    const spent = await args.commitAnchor(claimed.subject, claimed.anchor);
    if (!spent) return FAILED;
  }

  return { ok: true, subject: claimed.subject, expiresAtMs: claimed.expiresAtMs };
}
