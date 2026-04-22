import { hash as argonHash, verify as argonVerify } from "@node-rs/argon2";

// OWASP-recommended argon2id parameters (2024 guidance):
//   memoryCost: 19 MiB, timeCost: 2, parallelism: 1
// These strike a balance between login latency (~20ms on typical hardware)
// and brute-force resistance. If hashing becomes a bottleneck, tune memoryCost
// before parallelism — memory hardness is what defeats GPU attacks.
//
// algorithm: 2 = Argon2id (best of argon2i + argon2d).
// We inline the numeric value instead of importing Algorithm because the
// @node-rs/argon2 enum is const and breaks verbatimModuleSyntax imports.
const HASH_OPTIONS = {
  algorithm: 2,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

export async function hashPassword(password: string): Promise<string> {
  return argonHash(password, HASH_OPTIONS);
}

// Returns true if the password matches. Never throws on wrong passwords —
// only on malformed hash strings (which would be a bug, not a login attempt).
export async function verifyPassword(hashString: string, password: string): Promise<boolean> {
  try {
    return await argonVerify(hashString, password);
  } catch {
    // argon2 throws on unparseable hash — treat as mismatch rather than 500
    // to avoid revealing which accounts have corrupted stored hashes.
    return false;
  }
}
