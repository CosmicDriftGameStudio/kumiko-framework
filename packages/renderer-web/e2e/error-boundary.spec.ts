import { expect, test } from "@cosmicdrift/kumiko-testing/e2e";
import { SCREEN_ERROR_FALLBACK_TEST_ID } from "@cosmicdrift/kumiko-types/error-boundary";
import { BOOM_SCREEN_ID } from "./fixtures/schema";

test.use({ expectErrorBoundary: true });

test("a screen that throws while rendering shows the fallback card and keeps the shell usable", async ({
  page,
}, testInfo) => {
  await page.goto(`/${BOOM_SCREEN_ID}`);

  const fallback = page.getByTestId(SCREEN_ERROR_FALLBACK_TEST_ID);
  await expect(fallback).toBeVisible();
  await expect(fallback).toContainText("test:screen:boom");

  await expect(page.getByText("Renderer-Web E2E")).toBeVisible();
  await expect(page.getByText("Things")).toBeVisible();

  await fallback.screenshot({ path: testInfo.outputPath("error-boundary-card.png") });
  await page.screenshot({ path: testInfo.outputPath("error-boundary-page.png") });

  await page.getByText("Things").click();
  await expect(page.getByTestId(SCREEN_ERROR_FALLBACK_TEST_ID)).toHaveCount(0);
  await expect(page.getByText("Renderer-Web E2E")).toBeVisible();
});
