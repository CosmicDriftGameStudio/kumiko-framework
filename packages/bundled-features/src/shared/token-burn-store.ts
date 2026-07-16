// Single-use enforcement for HMAC-signed auth tokens (password-reset,
// email-verification, MFA setup/challenge).
//
// Problem: the token itself carries only userId + expiry + signature.
// Without server-side burn, the same token can be replayed within its
// TTL — an attacker with short-lived mailbox access (Shoulder-Surfing,
// Mail-Forwarding, stolen laptop) can re-use a link AFTER the legitimate
// user has already consumed it. Industry standard (Auth0, Stripe, GitHub,
// Google) is single-use.
//
// Mechanism: `SET burn:<purpose>:<userId>:<expiresAtMs> "1" EX <ttl> NX`.
// First caller wins ("OK"), replay loses (`null`). The key's natural TTL
// matches the token's — once the token would have expired anyway, Redis
// reclaims the marker.
//
// Storage footprint: one small string per used token, auto-evicted. At
// 10k password-resets/day × 15-min TTL, at any moment ~100 keys live.

import type Redis from "ioredis";

const BURN_KEY_PREFIX = "kumiko:auth:burn";

export type BurnResult = "fresh" | "already-used";

export async function burnToken(
  redis: Redis,
  purpose: string,
  userId: string,
  expiresAtMs: number,
  now: number = Date.now(),
): Promise<BurnResult> {
  // Floor at 60s so a near-expiry token still leaves a burn marker long
  // enough to block a replay; ceil() rounds token-TTL up so we never
  // evict the marker before the token itself becomes invalid.
  const ttlSeconds = Math.max(60, Math.ceil((expiresAtMs - now) / 1000));
  const key = burnKey(purpose, userId, expiresAtMs);
  const set = await redis.set(key, "1", "EX", ttlSeconds, "NX");
  return set === "OK" ? "fresh" : "already-used";
}

// Release a burn marker. Called by handlers when the post-burn write path
// failed for reasons unrelated to the token (e.g. every tenant stream
// rejected version_conflict — the token itself was never consumed). Without
// this, a legit retry with the same mail link would hit `already-used` and
// lock the user out permanently within TTL.
export async function unburnToken(
  redis: Redis,
  purpose: string,
  userId: string,
  expiresAtMs: number,
): Promise<void> {
  await redis.del(burnKey(purpose, userId, expiresAtMs));
}

function burnKey(purpose: string, userId: string, expiresAtMs: number): string {
  return `${BURN_KEY_PREFIX}:${purpose}:${userId}:${expiresAtMs}`;
}
