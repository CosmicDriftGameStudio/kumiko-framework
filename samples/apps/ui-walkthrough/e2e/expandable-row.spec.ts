// entityList expandableRow end to end: a row action inside the expanded
// sub-list writes through the real server and the parent row's counter
// follows. Uses "VW Golf" so the first row (screenshot subject) stays as seeded.

import { expect, test } from "@playwright/test";
import { loginAsAdmin } from "./_helpers/login";

test("marking a post in the expanded row updates the campaign's posted counter", async ({
  page,
}) => {
  await loginAsAdmin(page);
  await page.goto("/campaign-list");

  const campaignRow = page.locator('tr[data-testid^="row-"]', { hasText: "VW Golf (2019)" });
  const postedCell = campaignRow.locator('[data-testid$="-gepostet"]');
  await expect(postedCell).toHaveText("3");

  const toggle = campaignRow.locator('[data-testid$="-toggle"]');
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");

  const expansion = page.locator('[data-testid$="-expansion"]');
  const postRow = expansion.locator("tr", { hasText: "Story: Probefahrt" });
  await postRow.getByRole("button", { name: "Mark as posted" }).click();

  await expect(postedCell).toHaveText("4");
  await expect(postRow.getByRole("button", { name: "Mark as posted" })).toHaveCount(0);
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
});
