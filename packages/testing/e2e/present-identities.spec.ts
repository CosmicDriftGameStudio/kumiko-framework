import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  captureScreenshot,
  type PresentIdentity,
  runMatrix,
  SCREENSHOT_DIR_ENV,
} from "@cosmicdrift/kumiko-testing/e2e";
import { expect, type Page, test } from "@playwright/test";
import { DESKTOP_VIEWPORT } from "../src/e2e/constants";

// Always a fresh tmpdir: these specs must never write into a caller's SCREENSHOT_DIR.
const screenshotDir = mkdtempSync(join(tmpdir(), "kumiko-testing-identities-"));
process.env[SCREENSHOT_DIR_ENV] = screenshotDir;

// captureScreenshot reads SCREENSHOT_DIR per call; another spec file loaded
// into the same worker may have pointed it elsewhere.
test.beforeEach(() => {
  process.env[SCREENSHOT_DIR_ENV] = screenshotDir;
});

const GENERATED = "admin-3f2a9c1e-7b4d-4e0a-9c55-1d2e3f4a5b6c@example.test";
const PRESENTABLE = "anna@example.com";
const IDENTITIES: readonly PresentIdentity[] = [{ from: GENERATED, to: PRESENTABLE }];
const MATRIX_THEMES = ["light", "dark"] as const;

function identityUrl(email: string): string {
  return `/identity?email=${encodeURIComponent(email)}`;
}

function capturedPng(...segments: readonly string[]): Buffer {
  return readFileSync(join(screenshotDir, ...segments));
}

async function rerenderGeneratedIdentity(page: Page): Promise<void> {
  await page.evaluate("window.renderIdentity()");
  await expect(page.locator("#email")).toHaveValue(GENERATED);
}

async function expectPresentableDom(page: Page): Promise<void> {
  await expect(page.locator("#who")).toHaveText(`Signed in as ${PRESENTABLE}`);
  await expect(page.locator("#email")).toHaveValue(PRESENTABLE);
}

async function applyIdentityTheme(
  page: Page,
  theme: (typeof MATRIX_THEMES)[number],
): Promise<void> {
  await page.evaluate((dark) => {
    document.body.classList.toggle("dark", dark);
  }, theme === "dark");
  // A theme switch re-renders an app, which brings the generated identity back.
  await page.evaluate("window.renderIdentity()");
}

test("captureScreenshot shows the presentable identity on every capture of a page", async ({
  page,
}) => {
  await page.goto(identityUrl(PRESENTABLE));
  await captureScreenshot(page, "identity-reference");
  await page.goto(identityUrl(GENERATED));
  await captureScreenshot(page, "identity-unmapped");

  await captureScreenshot(page, "identity-first", { presentIdentities: IDENTITIES });
  await expectPresentableDom(page);
  await rerenderGeneratedIdentity(page);
  await captureScreenshot(page, "identity-second", { presentIdentities: IDENTITIES });
  await expectPresentableDom(page);

  const reference = capturedPng("identity-reference.png");
  expect(capturedPng("identity-unmapped.png").equals(reference)).toBe(false);
  expect(capturedPng("identity-first.png").equals(reference)).toBe(true);
  expect(capturedPng("identity-second.png").equals(reference)).toBe(true);
});

test("captureScreenshot refuses an empty `from`", async ({ page }) => {
  await page.goto(identityUrl(GENERATED));
  await expect(
    captureScreenshot(page, "identity-empty", { presentIdentities: [{ from: "", to: "x" }] }),
  ).rejects.toThrow(/`from` must not be empty/);
});

const previousViewports = process.env["SCREENSHOT_VIEWPORTS"];
process.env["SCREENSHOT_VIEWPORTS"] = "desktop";
runMatrix(
  [
    {
      name: "identity-matrix",
      flow: async (page, { presentIdentities }) => {
        await page.goto(identityUrl(GENERATED));
        presentIdentities(IDENTITIES);
      },
    },
  ],
  { themes: MATRIX_THEMES, applyTheme: applyIdentityTheme, locales: ["en"] },
);
if (previousViewports === undefined) delete process.env["SCREENSHOT_VIEWPORTS"];
else process.env["SCREENSHOT_VIEWPORTS"] = previousViewports;

// Runs after the runMatrix test above (tests in a file run in declaration order).
test("runMatrix re-applies the presentable identity after every theme switch", async ({ page }) => {
  await page.setViewportSize(DESKTOP_VIEWPORT);
  await page.goto(identityUrl(PRESENTABLE));
  for (const theme of MATRIX_THEMES) {
    await applyIdentityTheme(page, theme);
    const reference = await page.screenshot({ animations: "disabled" });
    const captured = capturedPng("identity-matrix", "en", theme, "desktop.png");
    expect(captured.equals(reference), `theme "${theme}"`).toBe(true);
  }
});
