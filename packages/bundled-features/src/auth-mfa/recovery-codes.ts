import { randomInt } from "node:crypto";
import { hashPassword, verifyPassword } from "../shared";

const RECOVERY_CODE_COUNT = 8;
// No ambiguous chars (0/O, 1/I) — these get read aloud or copy-typed from a
// screen during account-recovery, a context where a misread costs a support
// ticket, not just a retry.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

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
  return Promise.all(codes.map((code) => hashPassword(code)));
}

// Sequential (not Promise.all) — recovery-code lists are ≤8 entries, and a
// user typing a wrong code should not pay 8x argon2 cost when the first
// hash already matches.
export async function findMatchingRecoveryCodeIndex(
  code: string,
  hashes: readonly string[],
): Promise<number> {
  for (let i = 0; i < hashes.length; i++) {
    const hash = hashes[i];
    if (hash !== undefined && (await verifyPassword(hash, code))) return i;
  }
  return -1;
}
