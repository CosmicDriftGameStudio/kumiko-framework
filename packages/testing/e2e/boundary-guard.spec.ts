import { observeErrorBoundaries } from "@cosmicdrift/kumiko-testing/e2e";
import {
  ERROR_BOUNDARY_LOG_MARKER,
  ROOT_ERROR_FALLBACK_TEST_ID,
} from "@cosmicdrift/kumiko-types/error-boundary";
import { expect, test } from "@playwright/test";

test("reports a boundary log raised on a page opened via context.newPage()", async ({
  context,
}) => {
  const observer = observeErrorBoundaries(context);
  const secondPage = await context.newPage();
  await secondPage.evaluate(
    (marker) => console.error(`${marker}: boom`),
    ERROR_BOUNDARY_LOG_MARKER,
  );

  await expect.poll(async () => (await observer.findings()).boundaryLogs).toHaveLength(1);
});

test("counts a visible fallback on a second page", async ({ context }) => {
  const observer = observeErrorBoundaries(context);
  const secondPage = await context.newPage();
  await secondPage.setContent(`<div data-testid="${ROOT_ERROR_FALLBACK_TEST_ID}">oops</div>`);

  expect((await observer.findings()).visibleFallbacks).toBe(1);
});

test("does not throw when the page was closed before the check", async ({ context }) => {
  const observer = observeErrorBoundaries(context);
  const secondPage = await context.newPage();
  await secondPage.close();

  expect(await observer.findings()).toEqual({ boundaryLogs: [], visibleFallbacks: 0 });
});
