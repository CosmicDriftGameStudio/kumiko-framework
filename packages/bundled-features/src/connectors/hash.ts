import { randomBytes } from "node:crypto";
import { generateToken } from "@cosmicdrift/kumiko-framework/api";
import { hashOpaqueTokenSync } from "@cosmicdrift/kumiko-framework/crypto";
import { DEVICE_TOKEN_PREFIX } from "./constants.ts";

const DEVICE_TOKEN_DISPLAY_PREFIX_LENGTH = 12;

// Crockford base32 without I, L, O, U: 32 symbols, so a random byte modulo 32 is unbiased.
const USER_CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const USER_CODE_LENGTH = 8;
const USER_CODE_PATTERN = new RegExp(`^[${USER_CODE_ALPHABET}]{${USER_CODE_LENGTH}}$`);

// Device tokens are 32 random bytes, so one SHA-256 is the right hash (see personal-access-tokens/hash.ts).
export function hashDeviceSecret(secret: string): string {
  return hashOpaqueTokenSync(secret);
}

export function mintDeviceToken(): { raw: string; hash: string; prefix: string } {
  const raw = `${DEVICE_TOKEN_PREFIX}${generateToken()}`;
  return {
    raw,
    hash: hashDeviceSecret(raw),
    prefix: raw.slice(0, DEVICE_TOKEN_DISPLAY_PREFIX_LENGTH),
  };
}

export function mintDeviceCode(): { raw: string; hash: string } {
  const raw = generateToken();
  return { raw, hash: hashDeviceSecret(raw) };
}

export function mintUserCode(): { normalized: string; display: string } {
  const bytes = randomBytes(USER_CODE_LENGTH);
  const normalized = Array.from(bytes, (byte) => USER_CODE_ALPHABET[byte % 32]).join("");
  return { normalized, display: formatUserCode(normalized) };
}

export function formatUserCode(normalized: string): string {
  return `${normalized.slice(0, 4)}-${normalized.slice(4)}`;
}

// What a person types: case, dashes and spaces vary, and I/L/O are read as 1/0 (Crockford).
export function normalizeUserCode(input: string): string | null {
  const normalized = input
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/[IL]/g, "1")
    .replace(/O/g, "0");
  return USER_CODE_PATTERN.test(normalized) ? normalized : null;
}

export function hashUserCode(normalizedUserCode: string): string {
  return hashDeviceSecret(`user-code:${normalizedUserCode}`);
}
