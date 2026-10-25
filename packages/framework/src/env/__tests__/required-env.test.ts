import { describe, expect, test } from "bun:test";
import { requiredEnvFor } from "@cosmicdrift/kumiko-framework/env";

describe("requiredEnvFor", () => {
  test("returns the value of a set variable", () => {
    const requiredEnv = requiredEnvFor("backfill", { DATABASE_URL: "postgres://db/app" });
    expect(requiredEnv("DATABASE_URL")).toBe("postgres://db/app");
  });

  test("names the label and the variable when it is missing", () => {
    const requiredEnv = requiredEnvFor("backfill", {});
    expect(() => requiredEnv("DATABASE_URL")).toThrow(
      "[backfill] required env var DATABASE_URL is missing or empty",
    );
  });

  test("treats an empty value as missing", () => {
    const requiredEnv = requiredEnvFor("backfill", { DATABASE_URL: "" });
    expect(() => requiredEnv("DATABASE_URL")).toThrow("DATABASE_URL is missing or empty");
  });

  test("never echoes other variables of the source in the error", () => {
    const requiredEnv = requiredEnvFor("rewrap", { PLATFORM_KEK_V1: "secret-kek-material" });
    expect(() => requiredEnv("SUBJECT_KEYS_DATABASE_URL")).toThrow(
      expect.objectContaining({
        message: expect.not.stringContaining("secret-kek-material"),
      }),
    );
  });
});
