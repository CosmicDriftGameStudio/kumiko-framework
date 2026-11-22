import { describe, expect, test } from "bun:test";
import { LetterProviderNotConfiguredError, selectLetterProvider } from "../provider-resolver.ts";

const registry = { getExtensionUsages: () => [] };

const registryWithInmemory = {
  getExtensionUsages: () => [
    {
      extensionName: "letter-provider",
      entityName: "inmemory",
      options: { capabilities: {}, build: () => undefined },
    },
  ],
};

describe("selectLetterProvider", () => {
  test("production without the live switch is refused instead of simulating", () => {
    expect(() => selectLetterProvider(registry, { NODE_ENV: "production" })).toThrow(
      "LETTER_LIVE=true or LETTER_LIVE=false must be set",
    );
    expect(() =>
      selectLetterProvider(registry, { NODE_ENV: "production", LETTER_LIVE: "yes" }),
    ).toThrow(LetterProviderNotConfiguredError);
  });

  test("production with LETTER_LIVE=false selects the simulator", () => {
    const selected = selectLetterProvider(registryWithInmemory, {
      NODE_ENV: "production",
      LETTER_LIVE: "false",
    });
    expect(selected).toMatchObject({ name: "inmemory", live: false });
  });

  test("outside production a missing switch selects the simulator", () => {
    expect(selectLetterProvider(registryWithInmemory, {})).toMatchObject({
      name: "inmemory",
      live: false,
    });
    expect(selectLetterProvider(registryWithInmemory, { NODE_ENV: "development" }).live).toBe(
      false,
    );
  });

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
