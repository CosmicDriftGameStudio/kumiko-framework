// multiSelect optionsAvailabilityQuery in real Chromium: an option the query
// marks disabled is not offered in the combobox, the plain screen still lists it.

import { expect, type Page, test } from "@playwright/test";

async function openRolesCombobox(page: Page, navLabel: string): Promise<void> {
  await page.goto("/");
  await page.getByText(navLabel, { exact: true }).click();
  const combobox = page.getByTestId("combobox-kumiko-edit-roles");
  await expect(combobox).toBeVisible();
  await combobox.click();
  await expect(page.getByRole("option", { name: "Editor" })).toBeVisible();
}

test("multiSelect without availability query offers TenantAdmin", async ({ page }) => {
  await openRolesCombobox(page, "Roles plain");
  await expect(page.getByRole("option", { name: "TenantAdmin" })).toBeVisible();
});

test("multiSelect with availability query hides the disabled TenantAdmin", async ({ page }) => {
  await openRolesCombobox(page, "Roles availability");
  for (const role of ["User", "Member", "Editor", "Admin"]) {
    await expect(page.getByRole("option", { name: role, exact: true })).toBeVisible();
  }
  await expect(page.getByRole("option", { name: "TenantAdmin" })).toHaveCount(0);
});
