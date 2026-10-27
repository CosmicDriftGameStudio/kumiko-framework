// @runtime test
// Assert-E2E for the managed-pages body editor: the seeded Markdown "about"
// page opens in the document editor, an edit is saved, and the public page
// serves the typed text as a document.

import { expect, boundaryGuardedTest as test } from "@cosmicdrift/kumiko-testing/e2e";
import { loginAsAdmin } from "./_helpers/login";

const TYPED_TEXT = "Typed in the document editor.";

test("TenantAdmin edits the Markdown about page and the public page serves the new text", async ({
  page,
}) => {
  await loginAsAdmin(page);
  await page.goto("/tenant-admin/page-list");
  await page.getByRole("row").filter({ hasText: "About Acme" }).click();
  await page.waitForURL(/\/page-edit/);
  const form = page.getByTestId("render-edit-form");
  await expect(form).toBeVisible();

  // The seeded body links to a relative path, which the editor cannot keep.
  await expect(form.getByText(/relative links/)).toBeVisible();

  const editor = form.locator('[contenteditable="true"]').first();
  await expect(editor).toBeVisible();
  await expect(editor).toContainText("We build calm software");
  await editor.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type(` ${TYPED_TEXT}`);

  const saved = page.waitForResponse(
    (response) => response.url().includes("/api/write") && response.request().method() === "POST",
  );
  await page.getByTestId("render-edit-submit").click();
  expect((await saved).ok()).toBe(true);

  const publicPage = await page.request.get("/p/about");
  expect(publicPage.ok()).toBe(true);
  const html = await publicPage.text();
  expect(html).toContain(TYPED_TEXT);
  expect(html).toContain("We build calm software");
});
