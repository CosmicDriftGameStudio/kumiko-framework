import { describe, expect, test } from "bun:test";
import { withEnv, withEnvForEachTest, withEnvForSuite } from "../with-env.ts";

describe("withEnvForSuite / withEnvForEachTest", () => {
  describe("outer suite", () => {
    withEnvForSuite({ KUMIKO_TEST_PRESET: "preset" });

    describe("inner each-test", () => {
      withEnvForEachTest({ KUMIKO_TEST_PRESET: undefined, KUMIKO_TEST_EACH: "on" });

      test("applies the per-test override on top of the suite value", () => {
        expect(process.env.KUMIKO_TEST_PRESET).toBeUndefined();
        expect(process.env.KUMIKO_TEST_EACH).toBe("on");
      });
    });

    test("restores the suite value after the inner describe", () => {
      expect(process.env.KUMIKO_TEST_PRESET).toBe("preset");
      expect(process.env.KUMIKO_TEST_EACH).toBeUndefined();
    });
  });

  test("restores the original env after the suite", () => {
    expect(process.env.KUMIKO_TEST_PRESET).toBeUndefined();
    expect(process.env.KUMIKO_TEST_EACH).toBeUndefined();
  });
});

describe("withEnv", () => {
  test("sets the value inside and restores the previous one afterwards", async () => {
    const key = "KUMIKO_WITH_ENV_TEST_A";
    process.env[key] = "before";
    try {
      const seen = await withEnv({ [key]: "during" }, () => process.env[key]);
      expect(seen).toBe("during");
      expect(process.env[key]).toBe("before");
    } finally {
      delete process.env[key];
    }
  });

  test("removes a previously missing key afterwards instead of storing 'undefined'", async () => {
    const key = "KUMIKO_WITH_ENV_TEST_B";
    delete process.env[key];
    await withEnv({ [key]: "during" }, () => {
      expect(process.env[key]).toBe("during");
    });
    expect(key in process.env).toBe(false);
  });

  test("an undefined override deletes inside and restores afterwards", async () => {
    const key = "KUMIKO_WITH_ENV_TEST_C";
    process.env[key] = "before";
    try {
      await withEnv({ [key]: undefined }, () => {
        expect(key in process.env).toBe(false);
      });
      expect(process.env[key]).toBe("before");
    } finally {
      delete process.env[key];
    }
  });

  test("restores and propagates the error when run throws", async () => {
    const key = "KUMIKO_WITH_ENV_TEST_D";
    delete process.env[key];
    await expect(
      withEnv({ [key]: "during" }, () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(key in process.env).toBe(false);
  });
});
