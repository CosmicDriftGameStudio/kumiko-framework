import { randomInt } from "node:crypto";
import { hashPassword, verifyPassword } from "../shared";

const RECOVERY_CODE_COUNT = 8;
// No ambiguous chars (0/O, 1/I) — these get read aloud or copy-typed from a
// screen during account-recovery, a context where a misread costs a support
// ticket, not just a retry.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

// Recovery codes get read aloud or copy-typed from a screen — a user retyping
// "abcd1234" lowercase or without the dash must still match. Applied on both
// sides (hash-time here strips the group separator before hashing, keeping
// hash and verify identical if generation ever changes) so a formatting
// slip never surfaces as "wrong code" for an otherwise-correct code.
function normalizeRecoveryCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z2-9]/g, "");
}

function randomCodeGroup(): string {
  let out = "";
  for (let i = 0; i < 4; i++) {
    out += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }
  return out;
}

function generateRecoveryCode(): string {
  return `${randomCodeGroup()}-${randomCodeGroup()}`;
}

export function generateRecoveryCodes(count: number = RECOVERY_CODE_COUNT): string[] {
  return Array.from({ length: count }, generateRecoveryCode);
}

// Reuses the same argon2id hashing as passwords — recovery codes are
// bearer-secrets of comparable sensitivity (whoever has one can log in).
export async function hashRecoveryCodes(codes: readonly string[]): Promise<string[]> {
  return Promise.all(codes.map((code) => hashPassword(normalizeRecoveryCode(code))));
}

// Sequential (not Promise.all) — recovery-code lists are ≤8 entries, and a
// user typing a wrong code should not pay 8x argon2 cost when the first
// hash already matches.
export async function findMatchingRecoveryCodeIndex(
  code: string,
  hashes: readonly string[],
): Promise<number> {
  const normalized = normalizeRecoveryCode(code);
  for (let i = 0; i < hashes.length; i++) {
    const hash = hashes[i];
    if (hash !== undefined && (await verifyPassword(hash, normalized))) return i;
  }
  return -1;
}
