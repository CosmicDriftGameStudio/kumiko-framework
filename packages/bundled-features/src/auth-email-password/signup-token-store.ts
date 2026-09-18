// Redis-backed pre-activation token store for magic-link signup.
//
// Subject is the (normalized) email — the user doesn't exist yet, so
// there's no userId claim for an HMAC-signed token to bind to. The store
// mechanics (bidirectional token↔subject mapping, sha256-hashed keys,
// single-use burn) live in shared/single-use-token-store.ts — this file
// only wires the signup key prefixes onto it and normalizes the email
// used as the subject id.
//
// No collision with reset/verify/invite tokens: all signup keys carry the
// `signup:`-prefix.

import type Redis from "ioredis";
import { createSingleUseTokenStore } from "../shared";

/** Email normalization — single source for every lookup layer (used
 *  internally by the store AND by callers that need a consistent form
 *  in the return body / mail send). Previously two places called
 *  `.toLowerCase()` — one source means no drift. */
export function normalizeEmail(email: string): string {
  return email.toLowerCase();
}

const store = createSingleUseTokenStore({
  tokenPrefix: "signup:by-token:",
  subjectPrefix: "signup:by-email:",
  burnPrefix: "signup:burn:",
});

/** Stores the pair bidirectionally and sets TTL on both keys.
 *  Idempotent — re-writing the same token-email pair is fine. */
export async function storeSignupToken(
  redis: Redis,
  args: { email: string; token: string; ttlSeconds: number },
): Promise<void> {
  return store.store(redis, {
    subjectId: normalizeEmail(args.email),
    token: args.token,
    ttlSeconds: args.ttlSeconds,
  });
}

/** Lookup: email for a token. Null if the token no longer exists
 *  (expired, already consumed, or invalid). */
export const getEmailForSignupToken = store.getSubjectForToken;

/** Deletes a still-live signup token for this email, if one exists. Used
 *  by signup-request on every request; a fresh token + by-email entry
 *  follows right after, so this is "at most one live token per email." */
export async function invalidateExistingSignupToken(redis: Redis, email: string): Promise<boolean> {
  return store.invalidateExistingBySubject(redis, normalizeEmail(email));
}

/** Single-use burn: if two tabs click the confirm link at the same time,
 *  the first one wins, the second gets "already-used". */
export const burnSignupToken = store.burn;

/** Cleanup after a successful confirm — deletes both lookup keys.
 *  The burn key stays (prevents replay within the burn TTL). */
export async function deleteSignupToken(
  redis: Redis,
  args: { email: string; token: string },
): Promise<void> {
  return store.deleteBoth(redis, { subjectId: normalizeEmail(args.email), token: args.token });
}

/** Burn release for failed-confirm paths (DB error etc.) so a legitimate
 *  retry isn't blocked by a stale burn marker. */
export const unburnSignupToken = store.unburn;
