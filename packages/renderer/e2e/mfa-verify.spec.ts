// MfaVerifyScreen in real Chromium: six-cell code input, autofocus,
// auto-submit on the sixth digit, recovery-code fallback. Screenshots go to
// SCREENSHOT_DIR (design review) or the test output dir.

import { expect, boundaryGuardedTest as test } from "@cosmicdrift/kumiko-testing/e2e";
import type { Page } from "@playwright/test";

function screenshotPath(testInfo: { outputPath: (name: string) => string }, name: string): string {
  const dir = process.env["SCREENSHOT_DIR"];
  return dir !== undefined ? `${dir}/${name}` : testInfo.outputPath(name);
}

const codeInput = (page: Page) => page.getByRole("textbox", { name: /^Code/ });

const THEMES = ["light", "dark"] as const;
type Theme = (typeof THEMES)[number];

async function applyTheme(page: Page, theme: Theme): Promise<void> {
  await page.evaluate((isDark) => {
    document.documentElement.classList.toggle("dark", isDark);
  }, theme === "dark");
}

async function mockApi(page: Page): Promise<{ verifyBodies: unknown[] }> {
  const verifyBodies: unknown[] = [];
  await page.route("**/api/**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "{}" }),
  );
  await page.route("**/api/auth/mfa/verify", async (route) => {
    verifyBodies.push(route.request().postDataJSON());
    await route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({
        isSuccess: false,
        error: { code: "invalid_code", details: { reason: "invalid_totp_code" } },
      }),
    });
  });
  return { verifyBodies };
}

test.use({ viewport: { width: 480, height: 760 } });

for (const theme of THEMES) {
  test.describe(`mfa verify (${theme})`, () => {
    test("a: loads with the code input focused", async ({ page }, testInfo) => {
      await mockApi(page);
      await page.goto("/mfa-verify");
      await applyTheme(page, theme);
      const input = codeInput(page);
      await expect(input).toBeFocused();
      await expect(input).toHaveValue("");
      await page.screenshot({
        path: screenshotPath(testInfo, `a-leer-fokus-${theme}.png`),
        animations: "disabled",
      });
    });

    test("b: partial input does not submit", async ({ page }, testInfo) => {
      const { verifyBodies } = await mockApi(page);
      await page.goto("/mfa-verify");
      await applyTheme(page, theme);
      await expect(codeInput(page)).toBeFocused();
      await page.keyboard.type("123");
      await expect(codeInput(page)).toHaveValue("123");
      expect(verifyBodies).toHaveLength(0);
      await page.screenshot({
        path: screenshotPath(testInfo, `b-teilweise-${theme}.png`),
        animations: "disabled",
      });
    });

    test("c: sixth digit submits once; wrong code clears and refocuses", async ({
      page,
    }, testInfo) => {
      const { verifyBodies } = await mockApi(page);
      await page.goto("/mfa-verify");
      await applyTheme(page, theme);
      await expect(codeInput(page)).toBeFocused();
      await page.keyboard.type("000000");
      await expect(page.getByText("Ungültiger Code. Bitte erneut versuchen.")).toBeVisible();
      expect(verifyBodies).toHaveLength(1);
      expect(verifyBodies[0]).toMatchObject({ code: "000000" });
      const input = codeInput(page);
      await expect(input).toHaveValue("");
      await expect(input).toBeFocused();
      await expect(page.locator("html")).toHaveClass(theme === "dark" ? /dark/ : /^(?!.*dark)/);
      await page.screenshot({
        path: screenshotPath(testInfo, `c-fehler-${theme}.png`),
        animations: "disabled",
      });
    });

    test("d: recovery code mode focuses a text field without auto-submit", async ({
      page,
    }, testInfo) => {
      const { verifyBodies } = await mockApi(page);
      await page.goto("/mfa-verify");
      await applyTheme(page, theme);
      await page.getByRole("button", { name: "Recovery-Code verwenden" }).click();
      const input = page.getByRole("textbox", { name: /^Recovery-Code/ });
      await expect(input).toBeFocused();
      await page.keyboard.type("abcd-efgh");
      await expect(input).toHaveValue("abcd-efgh");
      expect(verifyBodies).toHaveLength(0);
      // The click leaves the pointer on the toggle; its hover underline would skew the comparison with a-c.
      await page.mouse.move(0, 0);
      await page.screenshot({
        path: screenshotPath(testInfo, `d-recovery-${theme}.png`),
        animations: "disabled",
      });
    });
  });
}
