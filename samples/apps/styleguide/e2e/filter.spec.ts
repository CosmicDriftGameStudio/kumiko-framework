// End-to-End-Beweis für den Faceted-Filter: Status=Draft im Dropdown
// auswählen → die Liste filtert serverseitig (payload.filters → executor.list
// → IN-Clause) → nur Draft-Rows bleiben. Reset stellt alle Rows wieder her.

import { expect, test } from "@playwright/test";

test("Faceted-Filter: Status=Draft filtert serverseitig, Reset hebt auf", async ({ page }) => {
  await page.goto("/item-list");
  await expect(page.getByText("Demo item #1")).toBeVisible();
  // Ausgangslage: alle 8 Seed-Rows da (Review/Published/Archived sichtbar).
  await expect(page.getByText("Demo item #2")).toBeVisible();
  await expect(page.getByText("Demo item #3")).toBeVisible();

  // Status-Facet öffnen + "Draft" anhaken.
  await page.getByTestId("facet-status").click();
  await page.getByTestId("facet-status-draft").click();
  await page.keyboard.press("Escape");

  // Seed cycelt draft/review/published/archived → Draft = #1 und #5.
  await expect(page.getByText("Demo item #1")).toBeVisible();
  await expect(page.getByText("Demo item #5")).toBeVisible();
  // Nicht-Draft-Rows sind serverseitig raus (nicht nur versteckt).
  await expect(page.getByText("Demo item #2")).toHaveCount(0);
  await expect(page.getByText("Demo item #3")).toHaveCount(0);

  // Reset-Button bringt alle Rows zurück.
  await page.getByTestId("facet-reset").click();
  await expect(page.getByText("Demo item #2")).toBeVisible();
  await expect(page.getByText("Demo item #3")).toBeVisible();
});
