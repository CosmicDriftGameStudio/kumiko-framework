import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import {
  requireScreenshotDir,
  SCREENSHOT_DIR_ENV,
  screenshotSpecsIgnore,
} from "../e2e/screenshot-dir";
import { captureScreenshot, runMatrix, runScreenshots } from "../e2e/screenshots";

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

describe("captureScreenshot", () => {
  test("is a no-op when SCREENSHOT_DIR is unset — never touches the page or the filesystem", async () => {
    const untouchablePage = new Proxy(
      {},
      {
        get(): never {
          throw new Error("captureScreenshot must not touch the page when SCREENSHOT_DIR is unset");
        },
      },
    ) as unknown as Page; // @cast-boundary test double, deliberately throws on any use

    await expect(captureScreenshot(untouchablePage, "step-1")).resolves.toBeUndefined();
  });

  test('opts.reducedMotion overrides the "reduce" default and fullPage reaches page.screenshot', async () => {
    const dir = mkdtempSync(join(tmpdir(), "capture-screenshot-"));
    process.env[SCREENSHOT_DIR_ENV] = dir;
    const emulateMediaCalls: unknown[] = [];
    const screenshotCalls: unknown[] = [];
    const fakePage = {
      emulateMedia: async (opts: unknown) => {
        emulateMediaCalls.push(opts);
      },
      on: () => {},
      off: () => {},
      evaluate: async () => "fixed-fingerprint",
      screenshot: async (opts: unknown) => {
        screenshotCalls.push(opts);
      },
    } as unknown as Page; // @cast-boundary test double, only the methods captureScreenshot's call chain uses

    try {
      await captureScreenshot(fakePage, "step-1", { reducedMotion: "no-preference", fullPage: true });
      expect(emulateMediaCalls).toEqual([{ reducedMotion: "no-preference" }]);
      expect(screenshotCalls).toEqual([
        { path: `${dir}/step-1.png`, animations: "disabled", fullPage: true },
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
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
