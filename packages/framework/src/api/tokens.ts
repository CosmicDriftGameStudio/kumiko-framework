import { randomBytes } from "node:crypto";

// Security tokens (CSRF cookie, one-shot correlation tokens that must
// not be guessable from wall-clock time). Backend-only — imports
// `node:crypto` and must not be pulled into a Metro/Expo-Web bundle.
//
// Unlike `generateId` (v7), this must not leak the creation timestamp:
// a CSRF value whose first 6 bytes are "the millisecond the login
// happened" is predictable. Every bit here is unpredictable.
//
// 32 bytes = 256 bits — session-class strength. base64url = 43 chars,
// cookie- and URL-safe, matches the encoding of JWT segments / OAuth
// state / WebAuthn challenges.
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}
