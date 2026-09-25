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
import * as z from "zod";
import {
  createSingleUseTokenStore,
  hashSingleUseToken,
  type SignupHandoverBinding,
} from "../shared";

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

// Cross-device try-first handover (kumiko-framework#3035 follow-up,
// offlot-app#454): signup-request binds a verified tenant-handover grant to
// its own signup token, in a SIBLING Redis namespace keyed the same way
// (sha256(token)) so it stays byte-compatible with the token store above
// without going through it — the binding has its own lifecycle (survives a
// resend, is read once by signup-confirm) that doesn't fit the token↔email
// pairing. Only {entityType, rowId, sourceTenantId} is ever stored — never
// the grant token or the email (see shared/signup-handover.ts).
const SIGNUP_HANDOVER_KEY_PREFIX = "signup:handover:";

const signupHandoverBindingSchema = z.object({
  entityType: z.string().min(1),
  rowId: z.string().min(1),
  sourceTenantId: z.string().min(1),
});

function signupHandoverKeyForHash(tokenHash: string): string {
  return `${SIGNUP_HANDOVER_KEY_PREFIX}${tokenHash}`;
}

function signupHandoverKey(token: string): string {
  return signupHandoverKeyForHash(hashSingleUseToken(token));
}

function parseSignupHandoverBinding(raw: string): SignupHandoverBinding | null {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = signupHandoverBindingSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}

/** Binds a verified grant to this signup token, TTL-matched to the token
 *  itself so the binding never outlives (or is killed before) it. */
export async function storeSignupHandover(
  redis: Redis,
  args: { token: string; binding: SignupHandoverBinding; ttlSeconds: number },
): Promise<void> {
  await redis.set(
    signupHandoverKey(args.token),
    JSON.stringify(args.binding),
    "EX",
    args.ttlSeconds,
  );
}

/** Reads the binding for a still-live signup token, if any. */
export async function getSignupHandover(
  redis: Redis,
  token: string,
): Promise<SignupHandoverBinding | null> {
  const raw = await redis.get(signupHandoverKey(token));
  return raw === null ? null : parseSignupHandoverBinding(raw);
}

/** Carries a still-live binding over to a resend, before the old token is
 *  invalidated: reads the old token's hash off the store's by-email entry
 *  (never the token itself), fetches the binding under that hash, and
 *  deletes it — the fresh token gets its own storeSignupHandover call with
 *  the same binding right after. Null when there was no live binding. */
export async function takeOverSignupHandoverForResend(
  redis: Redis,
  email: string,
): Promise<SignupHandoverBinding | null> {
  const oldTokenHash = await store.getTokenHashForSubject(redis, normalizeEmail(email));
  if (oldTokenHash === null) return null;
  const raw = await redis.get(signupHandoverKeyForHash(oldTokenHash));
  if (raw === null) return null;
  await redis.del(signupHandoverKeyForHash(oldTokenHash));
  return parseSignupHandoverBinding(raw);
}

/** Cleanup after signup-confirm has read (and acted on, or logged a failed
 *  claim for) the binding. */
export async function deleteSignupHandover(redis: Redis, token: string): Promise<void> {
  await redis.del(signupHandoverKey(token));
}
