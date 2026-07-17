// RFC 4648 Base32 (no padding) — the encoding TOTP secrets and otpauth://
// URIs use. No external dependency: the alphabet lookup is ~20 lines and every
// authenticator app (Google/Microsoft/Authy) expects exactly this variant.
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += ALPHABET[(value >>> (bits - 5)) & 0x1f];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += ALPHABET[(value << (5 - bits)) & 0x1f];
  }
  return output;
}

// Accepts lowercase and stray whitespace (authenticator apps and users
// copy-pasting secrets are inconsistent about casing) — normalizes case and
// strips whitespace before decoding, but throws on a genuinely invalid
// character so a corrupted stored secret fails loud at read time instead of
// silently producing wrong codes.
export function base32Decode(encoded: string): Buffer {
  const clean = encoded.trim().toUpperCase().replace(/\s+/g, "").replace(/=+$/, "");
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const index = ALPHABET.indexOf(char);
    if (index === -1) throw new Error(`base32Decode: invalid character "${char}"`);
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  // Leftover bits must be padding zeros (a canonical-length encoding never
  // leaves a full byte's worth, i.e. >=5 residual bits) — anything else means
  // truncated/non-canonical input decoded to the wrong byte count.
  if (bits >= 5 || (value & ((1 << bits) - 1)) !== 0) {
    throw new Error("base32Decode: invalid length or non-zero padding bits");
  }
  return Buffer.from(bytes);
}
