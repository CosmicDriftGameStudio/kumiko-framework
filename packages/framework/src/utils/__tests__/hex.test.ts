import { describe, expect, test } from "bun:test";
import { bytesToHex, digestHex } from "../hex.ts";

describe("bytesToHex", () => {
  test("renders lowercase, two chars per byte", () => {
    expect(bytesToHex(new Uint8Array([0, 1, 15, 16, 171, 255]))).toBe("00010f10abff");
  });

  test("empty input yields an empty string", () => {
    expect(bytesToHex(new Uint8Array())).toBe("");
  });
});

describe("digestHex", () => {
  test("SHA-1 of abc", async () => {
    expect(await digestHex("SHA-1", "abc")).toBe("a9993e364706816aba3e25717850c26c9cd0d89d");
  });

  test("SHA-256 of the empty string", async () => {
    expect(await digestHex("SHA-256", "")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  test("hashes the UTF-8 encoding of non-ASCII text", async () => {
    expect(await digestHex("SHA-256", "tök€n-ümlaut-🔑")).toBe(
      "6ae10b4ce9925a505868233c350202c7143f0a13f1f67f15f5b36fc8f77f9e8a",
    );
  });
});
