import { describe, expect, test } from "bun:test";
import { base32Decode, base32Encode } from "../base32";

describe("base32 encode/decode", () => {
  test("round-trips arbitrary bytes", () => {
    const bytes = Buffer.from("12345678901234567890", "ascii");
    expect(base32Decode(base32Encode(bytes))).toEqual(bytes);
  });

  test("decodes lowercase and RFC 4648 '=' padding", () => {
    const bytes = Buffer.from("12345678901234567890", "ascii");
    const encoded = base32Encode(bytes);
    const paddingLength = (8 - (encoded.length % 8)) % 8;
    const withPadding = encoded + "=".repeat(paddingLength);
    expect(base32Decode(withPadding.toLowerCase())).toEqual(bytes);
  });

  test("rejects a non-canonical length with non-zero residual bits", () => {
    // "AA" decodes to 10 residual bits of all-zero value — canonical (padding
    // zeros). A single stray char (5 bits, below the byte boundary but not a
    // clean multiple) with non-zero value must be rejected, not truncated.
    expect(() => base32Decode("B")).toThrow(/invalid length/);
  });

  test("throws on a genuinely invalid character", () => {
    expect(() => base32Decode("01")).toThrow(/invalid character/);
  });
});
