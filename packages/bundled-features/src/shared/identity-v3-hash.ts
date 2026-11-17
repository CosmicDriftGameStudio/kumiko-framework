// ASP.NET Core Identity V3 password-hash verifier.
//
// Why this lives in Kumiko: legacy migrations from .NET stacks (BMC: 22k
// users with Identity-V3 passwordHash) need login to keep working without
// forcing every user through a password-reset flow. New hashes are still
// argon2 — Identity-V3 is verify-only.
//
// Format specification (from ASP.NET Core Identity source —
// `Microsoft.AspNetCore.Identity.PasswordHasher`, `IdentityV3` mode):
//
//   Byte 0:        format marker (0x01 = V3)
//   Bytes 1..4:    PRF as uint32 big-endian
//                    1 = HMACSHA256
//                    2 = HMACSHA512
//                    (BMC uses 1; we accept both since the format does)
//   Bytes 5..8:    iteration count as uint32 big-endian
//   Bytes 9..12:   salt length in bytes as uint32 big-endian
//   Bytes 13..:    salt + derived subkey, concatenated
//
//   The whole blob is base64-encoded. Typical BMC hash starts with
//   "AQAAAAEAACcQ..." which decodes to:
//     0x01 (V3) | 0x00000001 (HMACSHA256) | 0x00002710 (10000 iter) | …
//
// We never produce these — `hashPassword()` (argon2id) is the canonical
// path. After a successful Identity-V3 login the application can re-hash
// the password into argon2 on the next change-password event; that's
// out-of-scope here.

import { pbkdf2Sync, timingSafeEqual } from "node:crypto";

const FORMAT_MARKER_V3 = 0x01;
const HEADER_LENGTH = 13; // 1 (format) + 4 (PRF) + 4 (iter) + 4 (saltLen)

const PRF_HMAC_SHA256 = 1;
const PRF_HMAC_SHA512 = 2;

// Quick sniff so the caller can route between argon2 and Identity-V3 without
// throwing parse errors on every login. Only checks the format marker; the
// full structural validation happens in `verifyIdentityV3Hash`.
export function isIdentityV3Hash(hashB64: string): boolean {
  const bytes = decodeBase64(hashB64);
  if (bytes === null) return false;
  return bytes.length >= HEADER_LENGTH && bytes[0] === FORMAT_MARKER_V3;
}

// Returns true on match. False on any mismatch — wrong password, malformed
// hash, unsupported PRF, garbled length fields. Never throws (mirrors
// `verifyPassword`'s contract — auth handlers don't want exceptions on
// pathological stored data, just a clean "no").
export function verifyIdentityV3Hash(password: string, hashB64: string): boolean {
  const bytes = decodeBase64(hashB64);
  if (bytes === null) return false;
  if (bytes.length < HEADER_LENGTH) return false;
  if (bytes[0] !== FORMAT_MARKER_V3) return false;

  const prf = bytes.readUInt32BE(1);
  const iterations = bytes.readUInt32BE(5);
  const saltLength = bytes.readUInt32BE(9);

  // Defensive: ASP.NET writes 16-byte salts, but the format technically
  // allows any length. We accept what's encoded but bail if the blob is
  // truncated mid-salt.
  if (saltLength === 0) return false;
  if (bytes.length <= HEADER_LENGTH + saltLength) return false; // need ≥1 subkey byte

  const salt = bytes.subarray(HEADER_LENGTH, HEADER_LENGTH + saltLength);
  const subkey = bytes.subarray(HEADER_LENGTH + saltLength);

  const algorithm = prfToNodeAlgorithm(prf);
  if (algorithm === null) return false;

  let derived: Buffer;
  try {
    derived = pbkdf2Sync(password, salt, iterations, subkey.length, algorithm);
  } catch {
    return false;
  }

  if (derived.length !== subkey.length) return false;
  return timingSafeEqual(derived, subkey);
}

function prfToNodeAlgorithm(prf: number): "sha256" | "sha512" | null {
  if (prf === PRF_HMAC_SHA256) return "sha256";
  if (prf === PRF_HMAC_SHA512) return "sha512";
  return null;
}

function decodeBase64(b64: string): Buffer | null {
  // Lenient decode: Buffer.from strips whitespace and ignores trailing garbage,
  // which is what we want for hashes pulled out of CSV exports / legacy DBs
  // that might carry stray CR/LF.
  if (typeof b64 !== "string" || b64.length === 0) return null;
  const buf = Buffer.from(b64, "base64");
  if (buf.length === 0) return null;
  return buf;
}
