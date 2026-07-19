import type Redis from "ioredis";
import { burnToken } from "../shared";
import { base32Decode } from "./base32";
import type { UserMfaRow } from "./db/queries";
import { findMatchingRecoveryCodeIndex } from "./recovery-codes";
import { STEP_SECONDS, verifyTotp } from "./totp";

export type MfaFactorVerifyResult =
  | { readonly ok: true; readonly method: "totp" }
  | { readonly ok: true; readonly method: "recovery"; readonly remainingHashes: readonly string[] }
  | { readonly ok: false };

// Shared by disable/regenerate-recovery (and later /auth/mfa/verify): tries
// TOTP first (cheap HMAC), falls back to recovery codes (argon2, slower —
// this is the rare path) only when the code isn't a valid TOTP. Callers
// that get `method: "recovery"` must persist `remainingHashes` as the new
// recoveryCodes.hashes — the matched code is single-use and already
// excluded from the returned array.
//
// `replay` opts into TOTP-counter burn (RFC 6238 §5.2: an accepted code
// must not verify again within its ±1-step window — otherwise a code an
// attacker observed once, via phishing proxy or shoulder-surfing, stays
// usable for ~90s of parallel logins). Omitted where a caller has no
// ctx.redis available; the code-verify itself still works, just without
// replay protection for that call.
export async function verifyMfaFactor(
  row: UserMfaRow,
  code: string,
  replay?: { readonly redis: Redis; readonly userId: string },
): Promise<MfaFactorVerifyResult> {
  const secret = base32Decode(row.totpSecret);
  const counter = verifyTotp(secret, code);
  if (counter !== false) {
    if (replay) {
      // Burn keyed by (userId, row.id, counter) — row.id, not just userId,
      // because disable+re-enable creates a fresh aggregate with a new
      // secret: two different secrets can hash to the same counter/step,
      // and without row.id in the key a burn from the OLD secret would
      // spuriously reject a fresh code under the NEW one. The counter's
      // own step-expiry doubles as the burn marker's TTL, so it
      // self-evicts once the code itself would have expired anyway — same
      // mechanism as burnToken's HMAC-token callers, just with a synthetic
      // expiresAtMs.
      const expiresAtMs = (counter + 1) * STEP_SECONDS * 1000;
      const burnUserId = `${replay.userId}:${row.id}`;
      const burned = await burnToken(replay.redis, "mfa-totp", burnUserId, expiresAtMs);
      if (burned === "already-used") return { ok: false };
    }
    return { ok: true, method: "totp" };
  }

  const hashes = row.recoveryCodes.hashes;
  const matchIndex = await findMatchingRecoveryCodeIndex(code, hashes);
  if (matchIndex === -1) return { ok: false };

  const remainingHashes = hashes.filter((_, i) => i !== matchIndex);
  return { ok: true, method: "recovery", remainingHashes };
}
