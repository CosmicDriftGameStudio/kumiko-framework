import { describe, expect, test } from "bun:test";
import {
  findMatchingRecoveryCodeIndex,
  generateRecoveryCodes,
  hashRecoveryCodes,
  isRecoveryCodeShaped,
} from "../recovery-codes.ts";

describe("isRecoveryCodeShaped", () => {
  test("accepts generated codes, also lowercase and without the dash", () => {
    const [code] = generateRecoveryCodes(1);
    expect(code).toBeDefined();
    expect(isRecoveryCodeShaped(code ?? "")).toBe(true);
    expect(isRecoveryCodeShaped((code ?? "").toLowerCase().replace("-", ""))).toBe(true);
  });

  test("rejects a 6-digit TOTP code and a too short code", () => {
    expect(isRecoveryCodeShaped("123456")).toBe(false);
    expect(isRecoveryCodeShaped("ABCD-EFG")).toBe(false);
  });
});

describe("findMatchingRecoveryCodeIndex", () => {
  test("a TOTP-shaped code does not match a hash of its normalized remainder", async () => {
    // Normalization strips the "1", so "123456" would hash-match "23456".
    const hashes = await hashRecoveryCodes(["23456"]);
    expect(await findMatchingRecoveryCodeIndex("123456", hashes)).toBe(-1);
  });

  test("a generated code finds its index", async () => {
    const codes = generateRecoveryCodes(3);
    const hashes = await hashRecoveryCodes(codes);
    expect(await findMatchingRecoveryCodeIndex(codes[2] ?? "", hashes)).toBe(2);
  });
});
