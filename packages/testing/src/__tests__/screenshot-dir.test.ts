import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  requireScreenshotDir,
  SCREENSHOT_DIR_ENV,
  screenshotSpecsIgnore,
} from "../e2e/screenshot-dir";
import { runMatrix, runScreenshots } from "../e2e/screenshots";

let saved: string | undefined;

beforeEach(() => {
  saved = process.env[SCREENSHOT_DIR_ENV];
  delete process.env[SCREENSHOT_DIR_ENV];
});

afterEach(() => {
  if (saved === undefined) delete process.env[SCREENSHOT_DIR_ENV];
  else process.env[SCREENSHOT_DIR_ENV] = saved;
});

describe("requireScreenshotDir", () => {
  test("returns the directory when set", () => {
    expect(requireScreenshotDir({ [SCREENSHOT_DIR_ENV]: "/tmp/shots" })).toBe("/tmp/shots");
  });

  test.each([undefined, ""])("throws with the reason when unset or empty (%p)", (value) => {
    expect(() => requireScreenshotDir({ [SCREENSHOT_DIR_ENV]: value })).toThrow(
      /SCREENSHOT_DIR is required.*overwrite the committed docs images/,
    );
  });

  test("the registrars fail at registration time, not at import", () => {
    const scenarios = [{ name: "a", flow: async () => {} }];
    expect(() => runScreenshots(scenarios)).toThrow(/SCREENSHOT_DIR is required/);
    expect(() => runMatrix(scenarios, { themes: ["light"], applyTheme: async () => {} })).toThrow(
      /SCREENSHOT_DIR is required/,
    );
  });
});

describe("screenshotSpecsIgnore", () => {
  test("ignores every screenshot spec in a normal run", () => {
    expect(screenshotSpecsIgnore({})).toEqual([
      "**/screenshots.spec.ts",
      "**/*.screenshots.spec.ts",
      "**/screenshots/**",
    ]);
  });

  test("ignores nothing once SCREENSHOT_DIR is set", () => {
    expect(screenshotSpecsIgnore({ [SCREENSHOT_DIR_ENV]: "/tmp/shots" })).toEqual([]);
  });

  test("treats an empty SCREENSHOT_DIR as a normal run", () => {
    expect(screenshotSpecsIgnore({ [SCREENSHOT_DIR_ENV]: "" })).not.toEqual([]);
  });
});
