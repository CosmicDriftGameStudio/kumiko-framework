// excludeFields per verb: the edit form shows an excluded field read-only
// and keeps it out of the submit payload; the create form hides it.

import { expect, test } from "@playwright/test";

test("update: excluded field is read-only, create: excluded field is missing", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    (globalThis as { __E2E_SEED__?: unknown }).__E2E_SEED__ = {
      thing: [
        { id: "thing-1", label: "Existing", isDone: false, status: "draft", notes: "frozen" },
      ],
    };
  });

  await page.goto("/");
  await expect(page.getByTestId("render-edit-form")).toBeVisible();
  await expect(page.getByTestId("field-notes")).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("write-excluded-fields-create.png") });

  await page.getByText("Things").click();
  await page
    .locator('[data-testid^="cell-"][data-testid$="-label"]', { hasText: "Existing" })
    .click();

  const notes = page.getByTestId("field-notes");
  await expect(notes).toBeVisible();
  await expect(notes.locator("input, textarea")).toBeDisabled();
  await page.screenshot({ path: testInfo.outputPath("write-excluded-fields-edit.png") });
});
