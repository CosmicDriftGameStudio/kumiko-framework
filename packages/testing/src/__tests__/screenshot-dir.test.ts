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

  // Fingerprint polls return a constant (page settled at once); scrollDeficit
  // polls pop the next scripted overflow value.
  function recordingPage(deficits: number[]) {
    const calls = {
      emulateMedia: [] as unknown[],
      screenshot: [] as unknown[],
      viewportSizes: [] as { width: number; height: number }[],
    };
    let viewport = { width: 1280, height: 800 };
    const page = {
      emulateMedia: async (opts: unknown) => {
        calls.emulateMedia.push(opts);
      },
      on: () => {},
      off: () => {},
      evaluate: async (fn: () => unknown) =>
        fn.name === "scrollDeficit" ? (deficits.shift() ?? 0) : "fixed-fingerprint",
      viewportSize: () => viewport,
      setViewportSize: async (size: { width: number; height: number }) => {
        viewport = size;
        calls.viewportSizes.push(size);
      },
      screenshot: async (opts: unknown) => {
        calls.screenshot.push({ ...(opts as object), viewportAtCapture: viewport });
      },
    } as unknown as Page; // @cast-boundary test double, only the methods captureScreenshot's call chain uses
    return { page, calls };
  }

  function withScreenshotDir(run: (dir: string) => Promise<void>): Promise<void> {
    const dir = mkdtempSync(join(tmpdir(), "capture-screenshot-"));
    process.env[SCREENSHOT_DIR_ENV] = dir;
    return run(dir).finally(() => rmSync(dir, { recursive: true, force: true }));
  }

  test('opts.reducedMotion overrides the "reduce" default and fit "fullPage" reaches page.screenshot', () =>
    withScreenshotDir(async (dir) => {
      const { page, calls } = recordingPage([]);
      await captureScreenshot(page, "step-1", { reducedMotion: "no-preference", fit: "fullPage" });
      expect(calls.emulateMedia).toEqual([{ reducedMotion: "no-preference" }]);
      expect(calls.screenshot).toEqual([
        {
          path: `${dir}/step-1.png`,
          animations: "disabled",
          fullPage: true,
          viewportAtCapture: { width: 1280, height: 800 },
        },
      ]);
    }));

  test('fit "content" grows the viewport by the overflow until none is left, then restores it', () =>
    withScreenshotDir(async (dir) => {
      const { page, calls } = recordingPage([300, 120, 0]);
      await captureScreenshot(page, "lease-detail", { fit: "content" });
      expect(calls.screenshot).toEqual([
        {
          path: `${dir}/lease-detail.png`,
          animations: "disabled",
          viewportAtCapture: { width: 1280, height: 1220 },
        },
      ]);
      expect(calls.viewportSizes).toEqual([
        { width: 1280, height: 1100 },
        { width: 1280, height: 1220 },
        { width: 1280, height: 800 },
      ]);
    }));

  test('fit "content" refuses to write a cropped screenshot when growth does not converge', () =>
    withScreenshotDir(async () => {
      const { page, calls } = recordingPage([100, 100, 100, 100, 100]);
      await expect(captureScreenshot(page, "endless", { fit: "content" })).rejects.toThrow(
        /did not converge after 4 rounds, 100px still overflow/,
      );
      expect(calls.screenshot).toEqual([]);
      expect(calls.viewportSizes.at(-1)).toEqual({ width: 1280, height: 800 });
    }));
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
