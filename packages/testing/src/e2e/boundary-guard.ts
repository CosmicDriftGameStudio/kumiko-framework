import {
  ERROR_BOUNDARY_LOG_MARKER,
  ROOT_ERROR_FALLBACK_TEST_ID,
  SCREEN_ERROR_FALLBACK_TEST_ID,
} from "@cosmicdrift/kumiko-types/error-boundary";
import { type BrowserContext, test as base, expect } from "@playwright/test";

export type BoundaryFindings = {
  readonly boundaryLogs: readonly string[];
  readonly visibleFallbacks: number;
};

const FALLBACK_SELECTOR = `[data-testid="${SCREEN_ERROR_FALLBACK_TEST_ID}"], [data-testid="${ROOT_ERROR_FALLBACK_TEST_ID}"]`;

// Listens on the context so pages opened later (popups, context.newPage()) are covered too.
export function observeErrorBoundaries(context: BrowserContext): {
  readonly findings: () => Promise<BoundaryFindings>;
} {
  const boundaryLogs: string[] = [];
  context.on("console", (msg) => {
    if (msg.type() === "error" && msg.text().includes(ERROR_BOUNDARY_LOG_MARKER)) {
      boundaryLogs.push(msg.text());
    }
  });
  return {
    async findings() {
      let visibleFallbacks = 0;
      for (const page of context.pages()) {
        // A spec may close its page or a page may crash; counting then would throw and mask the test result.
        if (page.isClosed()) continue;
        visibleFallbacks += await page
          .locator(FALLBACK_SELECTOR)
          .count()
          .catch(() => 0);
      }
      return { boundaryLogs: [...boundaryLogs], visibleFallbacks };
    },
  };
}

// An error boundary keeps the page alive, which also hides the failure from `pageerror`.
// Every spec using `test` from this package fails when a boundary caught something.
export const boundaryGuardedTest = base.extend<{
  failOnErrorBoundary: undefined;
  expectErrorBoundary: boolean;
}>({
  expectErrorBoundary: [false, { option: true }],
  failOnErrorBoundary: [
    async ({ context, expectErrorBoundary }, use) => {
      const observer = observeErrorBoundaries(context);
      await use(undefined);
      // skip: the spec provokes a boundary on purpose and asserts the fallback itself
      if (expectErrorBoundary) return;
      const { boundaryLogs, visibleFallbacks } = await observer.findings();
      expect(
        { boundaryLogs, visibleFallbacks },
        "an error boundary caught a render/effect error",
      ).toEqual({ boundaryLogs: [], visibleFallbacks: 0 });
    },
    { auto: true },
  ],
});
