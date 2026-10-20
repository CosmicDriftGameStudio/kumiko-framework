import { describe, expect, test } from "bun:test";
import { withEnv } from "../with-env.ts";

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
