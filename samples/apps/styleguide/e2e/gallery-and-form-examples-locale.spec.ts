// Regression for fw#1751: the gallery custom-screen demo blocks and the
// widget form-examples were static German content, never wired to i18n.
// Locks in the English translation so it can't silently regress.

import { expect, test } from "@playwright/test";

test("gallery renders the translated custom-screen demo blocks", async ({ page }) => {
  await page.goto("/gallery");

  await expect(page.getByTestId("sg-colors")).toBeVisible();

  await expect(page.getByText("Create loan")).toBeVisible();
  await expect(page.getByText("Interest rate %")).toBeVisible();
  await expect(page.getByText("Basic data")).toBeVisible();
  await expect(page.getByText("Maximum loan")).toBeVisible();

  await expect(page.getByText("Kredit anlegen")).toHaveCount(0);
  await expect(page.getByText("Stammdaten")).toHaveCount(0);
});

test("widget form examples render the translated field labels", async ({ page }) => {
  await page.goto("/widgets-forms");

  await expect(page.getByTestId("form-examples-page")).toBeVisible();

  await expect(page.getByText("Add contact")).toBeVisible();
  await expect(page.getByText("Asset ID")).toBeVisible();
  await expect(page.getByText("Date of birth")).toBeVisible();
  await expect(page.getByText("Follow-up needed")).toBeVisible();

  await expect(page.getByText("Kontakt anlegen")).toHaveCount(0);
  await expect(page.getByText("Wartungsprotokoll")).toHaveCount(0);
});
