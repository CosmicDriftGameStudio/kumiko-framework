import {
  ERROR_BOUNDARY_LOG_MARKER,
  ROOT_ERROR_FALLBACK_TEST_ID,
  SCREEN_ERROR_FALLBACK_TEST_ID,
} from "@cosmicdrift/kumiko-types/error-boundary";
import { test as base, expect } from "@playwright/test";

// An error boundary keeps the page alive, which also hides the failure from `pageerror`.
// Every spec using `test` from this package fails when a boundary caught something.
export const boundaryGuardedTest = base.extend<{
  failOnErrorBoundary: undefined;
  expectErrorBoundary: boolean;
}>({
  expectErrorBoundary: [false, { option: true }],
  failOnErrorBoundary: [
    async ({ page, expectErrorBoundary }, use) => {
      const boundaryLogs: string[] = [];
      page.on("console", (msg) => {
        if (msg.type() === "error" && msg.text().includes(ERROR_BOUNDARY_LOG_MARKER)) {
          boundaryLogs.push(msg.text());
        }
      });
      await use(undefined);
      // skip: the spec provokes a boundary on purpose and asserts the fallback itself
      if (expectErrorBoundary) return;
      const visibleFallbacks = await page
        .locator(
          `[data-testid="${SCREEN_ERROR_FALLBACK_TEST_ID}"], [data-testid="${ROOT_ERROR_FALLBACK_TEST_ID}"]`,
        )
        .count();
      expect(
        { boundaryLogs, visibleFallbacks },
        "an error boundary caught a render/effect error",
      ).toEqual({ boundaryLogs: [], visibleFallbacks: 0 });
    },
    { auto: true },
  ],
});
