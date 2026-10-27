// @runtime test
// Assert-E2E for creating a template-resolver collection entry from the nav "+":
// the create form saves a new entry, the tree lists it, its editor opens with the
// saved title, and a second entry with the same slug is refused.

import { expect, test } from "@cosmicdrift/kumiko-testing/e2e";
import { loginAsAdmin } from "./_helpers/login";

const ENTRY_SLUG = "late-payment-reminder";
const ENTRY_TITLE = "Late payment reminder";
const ENTRY_CONTENT = "Hello, our records show that your invoice is still unpaid.";

test("SystemAdmin creates a snippet entry, finds it in the tree and is refused a duplicate slug", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("kumiko:locale", "en"));
  await loginAsAdmin(page);
  await page.goto("/platform");

  const openCreateForm = async (): Promise<void> => {
    await page.getByLabel("New entry").first().click();
    await expect(page.getByTestId("collection-entry-create")).toBeVisible();
  };
  const fillSlugAndTitle = async (): Promise<void> => {
    await page.getByLabel("Slug").fill(ENTRY_SLUG);
    await page.getByLabel("Title").fill(ENTRY_TITLE);
  };

  await openCreateForm();
  await fillSlugAndTitle();
  await page.locator('[contenteditable="true"]').first().fill(ENTRY_CONTENT);
  await page.getByRole("button", { name: "Create" }).click();

  await expect(page.getByRole("button", { name: ENTRY_TITLE })).toBeVisible();
  await expect(page.getByLabel("Title")).toHaveValue(ENTRY_TITLE);

  await openCreateForm();
  await fillSlugAndTitle();
  await page.getByRole("button", { name: "Create" }).click();
  await expect(
    page.getByText(`An entry with the slug “${ENTRY_SLUG}” already exists`),
  ).toBeVisible();
});
