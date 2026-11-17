import { describe, expect, test } from "bun:test";
import { prodKmsModeDefault, prodStaticDirDefault } from "../prod-boot-defaults.ts";

const PRODUCTION = { NODE_ENV: "production" };

describe("prodKmsModeDefault", () => {
  test('defaults to "optional" in production', () => {
    expect(prodKmsModeDefault({}, PRODUCTION)).toBe("optional");
  });

  test("keeps an explicit kmsMode in production", () => {
    expect(prodKmsModeDefault({ kmsMode: "required" }, PRODUCTION)).toBe("required");
    const plaintext = { plaintextReason: "demo" };
    expect(prodKmsModeDefault({ kmsMode: plaintext }, PRODUCTION)).toBe(plaintext);
  });

  test("leaves the low-level KMS fields alone", () => {
    expect(prodKmsModeDefault({ blindIndexKey: "x" }, PRODUCTION)).toBeUndefined();
    expect(prodKmsModeDefault({ allowPlaintextPii: "demo" }, PRODUCTION)).toBeUndefined();
  });

  test("sets nothing outside production", () => {
    expect(prodKmsModeDefault({}, { NODE_ENV: "test" })).toBeUndefined();
    expect(prodKmsModeDefault({}, {})).toBeUndefined();
  });
});

describe("prodStaticDirDefault", () => {
  test('defaults to "./dist" in production when the folder exists', () => {
    expect(prodStaticDirDefault(undefined, PRODUCTION, () => true)).toBe("./dist");
  });

  test("stays unset in production when the folder is missing", () => {
    expect(prodStaticDirDefault(undefined, PRODUCTION, () => false)).toBeUndefined();
  });

  test("an explicit staticDir wins", () => {
    expect(prodStaticDirDefault("./public", PRODUCTION, () => true)).toBe("./public");
  });

  test("sets nothing outside production and does not touch the file system", () => {
    let probes = 0;
    const countingProbe = (): boolean => {
      probes += 1;
      return true;
    };

    expect(prodStaticDirDefault(undefined, { NODE_ENV: "test" }, countingProbe)).toBeUndefined();
    expect(probes).toBe(0);
  });
});
