// Forms never lose input silently: leaving a dirty form asks first, and a
// failed submit puts focus on the first invalid field.

import { expect, boundaryGuardedTest as test } from "@cosmicdrift/kumiko-testing/e2e";

function screenshotPath(testInfo: { outputPath: (name: string) => string }, name: string): string {
  const dir = process.env["SCREENSHOT_DIR"];
  return dir !== undefined ? `${dir}/${name}` : testInfo.outputPath(name);
}

test("dirty form: nav click asks before leaving; keep stays, discard navigates", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  const label = page.getByTestId("field-label").locator("input");
  await label.fill("Half-typed thing");

  await page.getByText("Things").click();
  const dialog = page.getByTestId("leave-guard-dialog");
  await expect(dialog).toBeVisible();
  await page.screenshot({ path: screenshotPath(testInfo, "leave-guard-dialog.png") });

  await dialog.getByRole("button", { name: "Keep editing" }).click();
  await expect(dialog).toBeHidden();
  await expect(label).toHaveValue("Half-typed thing");

  await page.getByText("Things").click();
  await page.getByTestId("leave-guard-dialog").getByRole("button", { name: "Discard" }).click();
  await expect(page.getByTestId("render-edit-form")).toBeHidden();
});

test("failed submit focuses the first invalid field", async ({ page }, testInfo) => {
  await page.goto("/");
  await expect(page.getByTestId("render-edit-form")).toBeVisible();

  const label = page.getByTestId("field-label").locator("input");
  // Save stays disabled on a clean form, so dirty another field while the required label stays empty.
  await page.getByTestId("field-isDone").locator('[role="switch"]').click();
  await page.getByRole("button", { name: "Save" }).click();

  await expect(label).toBeFocused();
  await expect(label).toHaveAttribute("aria-invalid", "true");
  await page.screenshot({ path: screenshotPath(testInfo, "focus-first-error.png") });
});

test("browser Forward on a dirty form asks; Discard lands on the target and one Back returns to the form", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByText("Things").click();
  await expect(page.getByTestId("render-edit-form")).toBeHidden();
  await page.goBack();
  const label = page.getByTestId("field-label").locator("input");
  await label.fill("Half-typed thing");

  await page.goForward();
  const dialog = page.getByTestId("leave-guard-dialog");
  await expect(dialog).toBeVisible();
  await expect(label).toHaveValue("Half-typed thing");

  await dialog.getByRole("button", { name: "Discard" }).click();
  await expect(page.getByTestId("render-edit-form")).toBeHidden();

  // The target must not be stored twice: a single Back reaches the form again.
  await page.goBack();
  await expect(page.getByTestId("render-edit-form")).toBeVisible();
});
