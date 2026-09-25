import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { isRealProviderRun, REAL_PROVIDERS_ENV, requireRealProviders } from "../real-providers";

const CI = "CI";
const FLAG = "KUMIKO_REAL_PROVIDERS";
const API_KEY = "ANTHROPIC_API_KEY";
const TOUCHED_ENV = [CI, FLAG, API_KEY];

describe("requireRealProviders", () => {
  const saved = new Map<string, string | undefined>();

  beforeEach(() => {
    for (const name of TOUCHED_ENV) {
      saved.set(name, process.env[name]);
      delete process.env[name];
    }
  });

  afterEach(() => {
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  test("throws when the flag is missing, even with an API key set", () => {
    process.env[API_KEY] = "sk-test";
    expect(() => requireRealProviders()).toThrow(/KUMIKO_REAL_PROVIDERS=1/);
  });

  test("throws when the flag has any value other than 1", () => {
    process.env[FLAG] = "true";
    expect(() => requireRealProviders()).toThrow(/KUMIKO_REAL_PROVIDERS=1/);
  });

  test("throws in CI even with the flag set", () => {
    process.env[CI] = "true";
    process.env[FLAG] = "1";
    expect(() => requireRealProviders()).toThrow(/never run in CI/);
  });

  test("does not throw with the flag set outside CI", () => {
    process.env[FLAG] = "1";
    expect(() => requireRealProviders()).not.toThrow();
  });

  test("treats CI=false and CI=0 as not CI", () => {
    process.env[FLAG] = "1";
    process.env[CI] = "false";
    expect(() => requireRealProviders()).not.toThrow();
    process.env[CI] = "0";
    expect(() => requireRealProviders()).not.toThrow();
  });
});

describe("isRealProviderRun", () => {
  test("reads the exported flag name from an explicit env map, defaulting to process.env", () => {
    expect(isRealProviderRun({ [REAL_PROVIDERS_ENV]: "1" })).toBe(true);
    expect(isRealProviderRun({ [REAL_PROVIDERS_ENV]: "true" })).toBe(false);
    expect(isRealProviderRun({})).toBe(false);
  });
});
