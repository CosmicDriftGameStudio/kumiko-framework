import { describe, expect, test } from "bun:test";
import {
  hashOpaqueToken,
  hashOpaqueTokenSync,
  opaqueTokenHashMatches,
} from "../opaque-token-hash.ts";

const GOLDEN: ReadonlyArray<readonly [string, string]> = [
  ["kumiko-golden-input", "ee04464d8789bc3c4f6dca3e054db5f870b69abf9c3d25a0e246ba83e1f6c394"],
  ["", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"],
  ["tök€n-ümlaut-🔑", "6ae10b4ce9925a505868233c350202c7143f0a13f1f67f15f5b36fc8f77f9e8a"],
];

describe("opaque token hash", () => {
  for (const [token, hash] of GOLDEN) {
    test(`sync and async match the stored golden hash for ${JSON.stringify(token)}`, async () => {
      expect(hashOpaqueTokenSync(token)).toBe(hash);
      expect(await hashOpaqueToken(token)).toBe(hash);
    });
  }

  const [goldenToken, goldenHash] = GOLDEN[0] ?? ["", ""];

  test("accepts the matching token", () => {
    expect(opaqueTokenHashMatches(goldenToken, goldenHash)).toBe(true);
  });

  test("rejects a wrong token", () => {
    expect(opaqueTokenHashMatches("other-token", goldenHash)).toBe(false);
  });

  test("rejects a stored hash of different length without throwing", () => {
    expect(opaqueTokenHashMatches(goldenToken, goldenHash.slice(0, 40))).toBe(false);
    expect(opaqueTokenHashMatches(goldenToken, `${goldenHash}00`)).toBe(false);
  });

  test("rejects an uppercase-hex stored hash", () => {
    expect(opaqueTokenHashMatches(goldenToken, goldenHash.toUpperCase())).toBe(false);
  });
});
