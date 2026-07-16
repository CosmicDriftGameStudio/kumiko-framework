import { base32Decode } from "./base32";
import type { UserMfaRow } from "./db/queries";
import { findMatchingRecoveryCodeIndex } from "./recovery-codes";
import { verifyTotp } from "./totp";

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
export async function verifyMfaFactor(
  row: UserMfaRow,
  code: string,
): Promise<MfaFactorVerifyResult> {
  const secret = base32Decode(row.totpSecret);
  if (verifyTotp(secret, code)) return { ok: true, method: "totp" };

  const hashes = row.recoveryCodes.hashes;
  const matchIndex = await findMatchingRecoveryCodeIndex(code, hashes);
  if (matchIndex === -1) return { ok: false };

  const remainingHashes = hashes.filter((_, i) => i !== matchIndex);
  return { ok: true, method: "recovery", remainingHashes };
}
