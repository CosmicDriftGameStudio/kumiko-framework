// The support reference (request id / error id) must be visible next to every
// error the user can hit, and copyable, so a screenshot or a pasted id is enough for support.

import { expect, boundaryGuardedTest as test } from "@cosmicdrift/kumiko-testing/e2e";
import { ROOT_ERROR_FALLBACK_TEST_ID } from "@cosmicdrift/kumiko-types/error-boundary";
import { FAILING_WRITE_REQUEST_ID } from "./fixtures/mock-dispatcher";

const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;

const seedThing = (): void => {
  (globalThis as { __E2E_SEED__?: unknown }).__E2E_SEED__ = {
    thing: [{ id: "thing-1", label: "Existing", isDone: false, status: "draft" }],
  };
};

test.describe("failed write", () => {
  test("a failing row action shows the request id in the toast", async ({ page }, testInfo) => {
    await page.addInitScript(seedThing);
    await page.goto("/thing-list-failing");

    await page.getByRole("button", { name: "Explode" }).click();

    const reference = page.getByTestId("toast-error-reference");
    await expect(reference).toContainText(FAILING_WRITE_REQUEST_ID);
    await expect(page.getByTestId("toast-error-reference-copy")).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("toast-error-reference.png") });
  });

  test("a failing record action shows the request id in the action error banner", async ({
    page,
  }, testInfo) => {
    await page.addInitScript(seedThing);
    await page.goto("/thing-edit-failing/thing-1");

    await page.getByRole("button", { name: "Explode" }).click();

    const banner = page.getByTestId("render-edit-action-error");
    await expect(banner).toContainText(FAILING_WRITE_REQUEST_ID);
    await page.screenshot({ path: testInfo.outputPath("action-error-reference.png") });
  });
});

test.describe("crashed app", () => {
  test.use({ expectErrorBoundary: true });

  test("the root fallback shows a copyable error id", async ({ page }, testInfo) => {
    await page.goto("/?crash-root");

    const fallback = page.getByTestId(ROOT_ERROR_FALLBACK_TEST_ID);
    await expect(fallback).toBeVisible();
    await expect(fallback).toContainText(UUID_PATTERN);
    await expect(page.getByTestId(`${ROOT_ERROR_FALLBACK_TEST_ID}-copy`)).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("root-fallback-error-id.png") });
  });
});
