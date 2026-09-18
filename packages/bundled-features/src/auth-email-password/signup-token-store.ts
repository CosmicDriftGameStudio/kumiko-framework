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
import { createSingleUseTokenStore } from "../shared/single-use-token-store";

/** Email-Normalisierung — single source für jede Lookup-Schicht (Store
 *  intern UND Caller die im Return-Body / Mail-Send eine konsistente
 *  Form brauchen). Vorher zwei Stellen mit `.toLowerCase()` — eine
 *  Quelle = kein Drift. */
export function normalizeEmail(email: string): string {
  return email.toLowerCase();
}

const store = createSingleUseTokenStore({
  tokenPrefix: "signup:by-token:",
  subjectPrefix: "signup:by-email:",
  burnPrefix: "signup:burn:",
});

/** Speichert das Pair bidirektional und setzt TTL auf beiden Keys.
 *  Idempotent — re-write derselben Token-Email-Kombi ist OK. */
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

/** Lookup: Email für einen Token. Null wenn Token nicht (mehr) existiert
 *  (abgelaufen, schon konsumiert, oder ungültig). */
export const getEmailForSignupToken = store.getSubjectForToken;

/** Deletes a still-live signup token for this email, if one exists. Used
 *  by signup-request on every request; a fresh token + by-email entry
 *  follows right after, so this is "at most one live token per email." */
export async function invalidateExistingSignupToken(redis: Redis, email: string): Promise<boolean> {
  return store.invalidateExistingBySubject(redis, normalizeEmail(email));
}

/** Single-Use-Burn: wenn zwei Tabs gleichzeitig den Confirm-Link klicken,
 *  gewinnt der erste, der zweite kriegt "already-used". */
export const burnSignupToken = store.burn;

/** Cleanup nach erfolgreichem Confirm — beide Lookup-Keys löschen.
 *  Burn-Key bleibt (verhindert Replay innerhalb der Burn-TTL). */
export async function deleteSignupToken(
  redis: Redis,
  args: { email: string; token: string },
): Promise<void> {
  return store.deleteBoth(redis, { subjectId: normalizeEmail(args.email), token: args.token });
}

/** Burn-Release für Failed-Confirm-Pfade (DB-Error etc.) damit ein
 *  legitimer Retry nicht durch einen stale Burn-Marker geblockt wird. */
export const unburnSignupToken = store.unburn;
