// Tests for the ASP.NET Core Identity V3 password-hash verifier.
//
// Strategy:
//   - "Round-trip" tests build a V3-format blob from scratch using the
//     documented byte-layout, then verify it. The Buffer.concat + readUInt32BE
//     in `buildV3Hash` are independent of the verifier's parser, so a bug in
//     either side surfaces as a mismatch.
//   - The hardcoded "BMC-shaped" hash bytes (0x01, PRF=1, iter=10000, salt=16
//     bytes) lock the format the BMC dump actually carries. If the parser
//     drifted to e.g. little-endian or a wrong header offset, the iter+saltLen
//     read would mis-align and verification would fail.
//   - Negative tests cover wrong password, format-marker mismatch, truncated
//     blobs, unsupported PRF — all the ways a verifier could leak a 500
//     instead of returning false.

import { describe, expect, test } from "bun:test";
import { pbkdf2Sync } from "node:crypto";
import { isIdentityV3Hash, verifyIdentityV3Hash } from "./identity-v3-hash";
import { verifyPassword } from "./password-hashing";

// --- Test helpers ---

const BMC_ITERATIONS = 10_000;
const BMC_SUBKEY_LENGTH = 32;

const PRF_HMAC_SHA256 = 1;
const PRF_HMAC_SHA512 = 2;

function buildV3Hash(args: {
  readonly password: string;
  readonly salt: Buffer;
  readonly iterations: number;
  readonly prf: number;
  readonly subkeyLength?: number;
}): string {
  const algorithm =
    args.prf === PRF_HMAC_SHA256 ? "sha256" : args.prf === PRF_HMAC_SHA512 ? "sha512" : null;
  if (algorithm === null) throw new Error(`unsupported test PRF: ${args.prf}`);

  const subkeyLength = args.subkeyLength ?? BMC_SUBKEY_LENGTH;
  const subkey = pbkdf2Sync(args.password, args.salt, args.iterations, subkeyLength, algorithm);

  const header = Buffer.alloc(13);
  header.writeUInt8(0x01, 0); // V3 format marker
  header.writeUInt32BE(args.prf, 1);
  header.writeUInt32BE(args.iterations, 5);
  header.writeUInt32BE(args.salt.length, 9);

  return Buffer.concat([header, args.salt, subkey]).toString("base64");
}

// Reproducible salt via static seed — using random salts in tests muddies
// the failure mode (was it the verifier or RNG flakiness?).
const FIXED_SALT_16 = Buffer.from("0123456789abcdef", "ascii");

describe("isIdentityV3Hash", () => {
  test("recognizes a real-shape BMC V3 hash by format marker", () => {
    const hash = buildV3Hash({
      password: "irrelevant",
      salt: FIXED_SALT_16,
      iterations: BMC_ITERATIONS,
      prf: PRF_HMAC_SHA256,
    });
    expect(isIdentityV3Hash(hash)).toBe(true);
    // Sanity: real BMC hashes start with this fixed prefix because the first
    // 9 header bytes are deterministic for HMAC-SHA256/10000-iter hashes.
    expect(hash.startsWith("AQAAAAEAACcQ")).toBe(true);
  });

  test("rejects argon2 hashes (different format prefix)", () => {
    expect(isIdentityV3Hash("$argon2id$v=19$m=19456,t=2,p=1$abc$def")).toBe(false);
  });

  test("rejects empty strings and garbage", () => {
    expect(isIdentityV3Hash("")).toBe(false);
    expect(isIdentityV3Hash("not-base64-!!!")).toBe(false);
  });
});

describe("verifyIdentityV3Hash — BMC-shaped (HMACSHA256, 10k iter, 16-byte salt)", () => {
  const password = "Test-Pa$$word-1!";
  const hash = buildV3Hash({
    password,
    salt: FIXED_SALT_16,
    iterations: BMC_ITERATIONS,
    prf: PRF_HMAC_SHA256,
  });

  test("accepts the correct password", () => {
    expect(verifyIdentityV3Hash(password, hash)).toBe(true);
  });

  test("rejects an incorrect password (no exception, just false)", () => {
    expect(verifyIdentityV3Hash("Wrong-Password!", hash)).toBe(false);
  });

  test("rejects empty password against a real hash", () => {
    expect(verifyIdentityV3Hash("", hash)).toBe(false);
  });
});

describe("verifyIdentityV3Hash — HMACSHA512 variant", () => {
  // ASP.NET also writes V3 hashes with PRF=2 (HMACSHA512). BMC doesn't use it
  // but we shouldn't break a future migration that does.
  const password = "another-secret";
  const hash = buildV3Hash({
    password,
    salt: FIXED_SALT_16,
    iterations: 50_000,
    prf: PRF_HMAC_SHA512,
  });

  test("verifies SHA512 hashes correctly", () => {
    expect(verifyIdentityV3Hash(password, hash)).toBe(true);
    expect(verifyIdentityV3Hash("not-it", hash)).toBe(false);
  });
});

describe("verifyIdentityV3Hash — malformed input", () => {
  test("returns false on truncated header", () => {
    // 5 bytes: format + half-PRF — not enough for the 13-byte header.
    const truncated = Buffer.from([0x01, 0x00, 0x00, 0x00, 0x01]).toString("base64");
    expect(verifyIdentityV3Hash("anything", truncated)).toBe(false);
  });

  test("returns false on unsupported PRF (e.g. 99)", () => {
    const password = "secret";
    const subkey = pbkdf2Sync(password, FIXED_SALT_16, 1000, 32, "sha256");
    const header = Buffer.alloc(13);
    header.writeUInt8(0x01, 0);
    header.writeUInt32BE(99, 1); // bogus PRF
    header.writeUInt32BE(1000, 5);
    header.writeUInt32BE(FIXED_SALT_16.length, 9);
    const hash = Buffer.concat([header, FIXED_SALT_16, subkey]).toString("base64");
    expect(verifyIdentityV3Hash(password, hash)).toBe(false);
  });

  test("returns false when subkey is missing", () => {
    // Header announces 16-byte salt and supplies it, but no subkey bytes.
    const header = Buffer.alloc(13);
    header.writeUInt8(0x01, 0);
    header.writeUInt32BE(1, 1);
    header.writeUInt32BE(10_000, 5);
    header.writeUInt32BE(16, 9);
    const hash = Buffer.concat([header, FIXED_SALT_16]).toString("base64");
    expect(verifyIdentityV3Hash("anything", hash)).toBe(false);
  });

  test("returns false on wrong format marker (e.g. 0x00 = legacy V2)", () => {
    const subkey = pbkdf2Sync("x", FIXED_SALT_16, 1000, 32, "sha256");
    const header = Buffer.alloc(13);
    header.writeUInt8(0x00, 0); // V2 marker, not supported here
    header.writeUInt32BE(1, 1);
    header.writeUInt32BE(1000, 5);
    header.writeUInt32BE(16, 9);
    const hash = Buffer.concat([header, FIXED_SALT_16, subkey]).toString("base64");
    expect(verifyIdentityV3Hash("x", hash)).toBe(false);
  });
});

describe("verifyPassword — routes between argon2 and Identity-V3", () => {
  test("accepts a V3 hash via the unified verifyPassword entry point", async () => {
    const password = "legacy-user-password";
    const hash = buildV3Hash({
      password,
      salt: FIXED_SALT_16,
      iterations: BMC_ITERATIONS,
      prf: PRF_HMAC_SHA256,
    });

    expect(await verifyPassword(hash, password)).toBe(true);
    expect(await verifyPassword(hash, "wrong")).toBe(false);
  });
});
