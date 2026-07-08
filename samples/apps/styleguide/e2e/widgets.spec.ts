// Render-Beweis für das Widget-Kit: die Katalog-Seite mountet, alle
// Sektionen rendern (Stats, Charts, Badges, ModeSwitch) und der
// ModeSwitch ist interaktiv.

import { expect, test } from "@playwright/test";

test("Widget-Katalog rendert und ModeSwitch schaltet", async ({ page }) => {
  await page.goto("/widgets");

  await expect(page.getByTestId("widgets-page")).toBeVisible();
  await expect(page.getByText("Portfolio")).toBeVisible();
  await expect(page.getByRole("img", { name: "Uptime der letzten 90 Tage" })).toBeVisible();
  await expect(page.getByRole("img", { name: "Antwortzeit-Verlauf" })).toBeVisible();
  await expect(page.getByText("major outage")).toBeVisible();

  // ModeSwitch: Wechsel aktualisiert aria-pressed + DetailList-Wert.
  const fixed = page.getByRole("button", { name: "Feste Rate" });
  await expect(fixed).toHaveAttribute("aria-pressed", "false");
  await fixed.click();
  await expect(fixed).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("Feste Rate", { exact: true }).nth(1)).toBeVisible();

  if (process.env["SCREENSHOT"] === "1") {
    await page.screenshot({ path: "/tmp/widgets-catalog.png", fullPage: true });
  }
});
