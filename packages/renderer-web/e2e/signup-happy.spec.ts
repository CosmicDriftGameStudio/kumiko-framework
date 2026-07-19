// SignupScreen happy-path in real Chromium via createPublicSurface.
// jsdom/happy-dom unit tests cover branches; this pins the browser mount
// (public surface + auth client i18n + form submit) against a mocked API.

import { expect, test } from "@playwright/test";

test("signup happy-path: email submit → success banner", async ({ page }) => {
  await page.route("**/api/auth/signup-request", async (route) => {
    expect(route.request().method()).toBe("POST");
    const body = route.request().postDataJSON() as { email?: string };
    expect(body.email).toBe("new@example.com");
    await route.fulfill({ status: 200, body: "{}" });
  });

  await page.goto("/signup");
  await expect(page.getByText("Account erstellen")).toBeVisible();

  await page.getByLabel(/^E-Mail/).fill("new@example.com");
  await page.getByRole("button", { name: "Aktivierungs-Link senden" }).click();

  await expect(page.getByText("Mail gesendet")).toBeVisible();
  await expect(page.getByRole("button", { name: "Mail erneut senden" })).toBeVisible();
});
