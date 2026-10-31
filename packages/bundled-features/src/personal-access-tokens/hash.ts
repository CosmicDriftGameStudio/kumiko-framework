import { generateToken, PAT_TOKEN_PREFIX } from "@cosmicdrift/kumiko-framework/api";
import { hashOpaqueTokenSync } from "@cosmicdrift/kumiko-framework/crypto";
import { PAT_PREFIX_DISPLAY_LENGTH } from "./web/constants.ts";

// A PAT is high-entropy (32 random bytes from generateToken). A single SHA-256
// is the right hash here: fast on the per-request auth path, and there's no
// brute-force surface that would justify argon2 (that's for low-entropy
// passwords). Only the hash is persisted — the plaintext exists once, in the
// create response.
export function hashPatToken(rawToken: string): string {
  return hashOpaqueTokenSync(rawToken);
}

export function mintPatToken(): { raw: string; hash: string; prefix: string } {
  const raw = `${PAT_TOKEN_PREFIX}${generateToken()}`;
  return { raw, hash: hashPatToken(raw), prefix: raw.slice(0, PAT_PREFIX_DISPLAY_LENGTH) };
}
