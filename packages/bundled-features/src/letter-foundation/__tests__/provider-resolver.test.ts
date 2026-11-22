import { describe, expect, test } from "bun:test";
import { selectLetterProvider } from "../provider-resolver.ts";

const registry = { getExtensionUsages: () => [] };

describe("selectLetterProvider", () => {
  test("the live switch outside production is refused before any provider is looked up", () => {
    expect(() =>
      selectLetterProvider(registry, { LETTER_LIVE: "true", LETTER_PROVIDER: "letterxpress" }),
    ).toThrow("only boots with NODE_ENV=production");
    expect(() =>
      selectLetterProvider(registry, { LETTER_LIVE: "true", NODE_ENV: "staging" }),
    ).toThrow("only boots with NODE_ENV=production");
  });

  test("in production the live switch passes the check and then needs a registered provider", () => {
    expect(() =>
      selectLetterProvider(registry, {
        LETTER_LIVE: "true",
        LETTER_PROVIDER: "letterxpress",
        NODE_ENV: "production",
      }),
    ).toThrow('provider "letterxpress" is not registered');
  });
});
