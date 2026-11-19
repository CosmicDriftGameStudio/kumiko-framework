import { describe, expect, test } from "bun:test";
import { normalizeRelativePath } from "../device-auth.ts";
import {
  formatUserCode,
  hashUserCode,
  mintDeviceToken,
  mintUserCode,
  normalizeUserCode,
} from "../hash.ts";

describe("user codes", () => {
  test("a minted code is 8 Crockford characters shown as XXXX-XXXX and survives normalization", () => {
    for (let i = 0; i < 200; i++) {
      const { normalized, display } = mintUserCode();
      expect(normalized).toMatch(/^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{8}$/);
      expect(display).toBe(formatUserCode(normalized));
      expect(normalizeUserCode(display)).toBe(normalized);
    }
  });

  test("normalization ignores case, dashes and spaces and reads I/L as 1 and O as 0", () => {
    expect(normalizeUserCode("ab12-cd34")).toBe("AB12CD34");
    expect(normalizeUserCode(" ab12 cd34 ")).toBe("AB12CD34");
    expect(normalizeUserCode("OIL0-1111")).toBe("01101111");
  });

  test("anything that cannot be a code is rejected", () => {
    for (const bad of ["", "ABC", "ABCD-EFGH-JK", "ABCD-EFG!", "UUUU-UUUU"]) {
      expect(normalizeUserCode(bad)).toBeNull();
    }
  });

  test("the stored hash is stable and not the code", () => {
    expect(hashUserCode("AB12CD34")).toBe(hashUserCode("AB12CD34"));
    expect(hashUserCode("AB12CD34")).not.toBe(hashUserCode("AB12CD35"));
    expect(hashUserCode("AB12CD34")).toHaveLength(64);
  });
});

describe("device tokens", () => {
  test("carry the ksat_ prefix and are stored as a 64-character hash", () => {
    const a = mintDeviceToken();
    const b = mintDeviceToken();
    expect(a.raw.startsWith("ksat_")).toBe(true);
    expect(a.hash).toHaveLength(64);
    expect(a.hash).not.toContain(a.raw);
    expect(a.raw).not.toBe(b.raw);
    expect(a.prefix).toBe(a.raw.slice(0, 12));
  });
});

describe("relative paths", () => {
  test("backslashes become slashes and dot segments are dropped", () => {
    expect(normalizeRelativePath("a\\b\\c.txt")).toBe("a/b/c.txt");
    expect(normalizeRelativePath("./a//b.txt")).toBe("a/b.txt");
  });

  test("paths that could leave the source folder are rejected", () => {
    for (const bad of [
      "",
      "/etc/passwd",
      "../a",
      "a/../../b",
      "C:\\x",
      "\\\\server\\share",
      "a\u0000b",
    ]) {
      expect(normalizeRelativePath(bad)).toBeNull();
    }
    expect(normalizeRelativePath("a/".repeat(600))).toBeNull();
  });
});
