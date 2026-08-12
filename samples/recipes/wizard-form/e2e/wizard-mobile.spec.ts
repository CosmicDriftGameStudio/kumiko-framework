// Wizard Form Sample — 375px mobile chrome (CosmicDriftGameStudio/kumiko-framework#1917)
//
// Acceptance from the Offlot counter-check (#1908): at the narrowest common
// phone width (iPhone SE/mini class, 375px), the progress indicator,
// back/next buttons, and step title must render correctly (no horizontal
// overflow, no overlap), and the next button must not disappear under the
// virtual keyboard after a text field gains focus. Pure test-gap fix against
// chrome already merged in #1886 — no new functionality.
//
// Runs in its own "mobile-375" Playwright project (see playwright.config.ts)
// against the same build-server as wizard.spec.ts, now with REAL Tailwind
// CSS instead of the earlier empty /styles.css stub (see the build-server.ts
// comment) — without real CSS, the layout assertions here would be fake
// assertions against unstyled browser default flow.

import { expect, type Locator, type Page, test } from "@playwright/test";

async function gotoWizard(page: Page): Promise<void> {
  await page.goto("/listing-wizard");
  await expect(page.getByTestId("render-edit-form")).toBeVisible();
}

async function selectCombobox(page: Page, field: string, optionLabel: string): Promise<void> {
  await page.getByTestId(`combobox-kumiko-edit-${field}`).click();
  await page.getByRole("option", { name: optionLabel, exact: true }).click();
}

function rectsOverlap(a: DOMRectLike, b: DOMRectLike): boolean {
  return !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top);
}

type DOMRectLike = { top: number; bottom: number; left: number; right: number };

async function boundingRect(locator: Locator): Promise<DOMRectLike> {
  const box = await locator.boundingBox();
  if (box === null) throw new Error("boundingRect: element has no box (not rendered/visible)");
  return { top: box.y, bottom: box.y + box.height, left: box.x, right: box.x + box.width };
}

async function assertNoOverlap(a: Locator, b: Locator): Promise<void> {
  const [rectA, rectB] = await Promise.all([boundingRect(a), boundingRect(b)]);
  expect(rectsOverlap(rectA, rectB)).toBe(false);
}

// Guard against a vacuously-green run: cardFooter (packages/renderer-web/
// src/primitives/index.tsx) sets "flex" on the actions footer. Without
// compiled Tailwind CSS this would stay the browser default "block" — the
// following layout assertions would then run against unstyled markup
// instead of the real chrome.
async function assertCssIsLive(page: Page): Promise<void> {
  const display = await page
    .getByTestId("render-edit-form-actions")
    .evaluate((el) => getComputedStyle(el).display);
  expect(display).toBe("flex");
}

test.describe("wizard-form — 375px mobile chrome (#1917)", () => {
  test("step 1: progress, step label, and Next fit the viewport without overlap", async ({
    page,
  }) => {
    await gotoWizard(page);
    await assertCssIsLive(page);

    const progress = page.getByTestId("render-edit-wizard-progress");
    const stepLabel = page.getByTestId("render-edit-wizard-step-label");
    const next = page.getByTestId("render-edit-wizard-next");

    await expect(progress).toBeVisible();
    await expect(stepLabel).toBeVisible();
    await expect(stepLabel).toHaveText("Step 1 of 3 · Basics");
    await expect(next).toBeVisible();
    // Step 1 has no Back button — asserted by the desktop spec too.
    await expect(page.getByTestId("render-edit-wizard-back")).toHaveCount(0);

    const overflowsHorizontally = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflowsHorizontally).toBe(false);

    await assertNoOverlap(progress, stepLabel);
    await assertNoOverlap(stepLabel, next);
  });

  test("step 2: Back and Next render side by side without overlapping", async ({ page }) => {
    await gotoWizard(page);
    await assertCssIsLive(page);
    await page.getByTestId("field-title").locator("input").fill("Vintage desk lamp");
    await selectCombobox(page, "category", "furniture");
    await page.getByTestId("render-edit-wizard-next").click();
    await expect(page.getByTestId("render-edit-wizard-step-label")).toHaveText(
      "Step 2 of 3 · Pricing",
    );

    const back = page.getByTestId("render-edit-wizard-back");
    const next = page.getByTestId("render-edit-wizard-next");
    await expect(back).toBeVisible();
    await expect(next).toBeVisible();
    await assertNoOverlap(back, next);
  });

  test("Next stays reachable after focusing a field and the viewport shrinking (simulated keyboard)", async ({
    page,
  }) => {
    await gotoWizard(page);
    await assertCssIsLive(page);

    const titleInput = page.getByTestId("field-title").locator("input");
    await titleInput.fill("Vintage desk lamp");
    await selectCombobox(page, "category", "furniture");
    await titleInput.focus();

    // Simulates a virtual keyboard covering roughly the bottom half of an
    // iPhone SE screen (667 -> 300 visible height) — the standard Playwright
    // pattern for mobile-keyboard testing (real devices don't expose keyboard
    // height to the page, so viewport-shrink is the closest approximation).
    await page.setViewportSize({ width: 375, height: 300 });

    const next = page.getByTestId("render-edit-wizard-next");
    // No scrollIntoView before this assertion — that would make it trivially
    // pass regardless of layout. toBeInViewport() checks the button is
    // actually inside the now-shrunk visual area, unassisted.
    await expect(next).toBeInViewport();

    // Functional confirmation: the button isn't just geometrically in
    // bounds, it's actually clickable and advances the wizard.
    await next.click();
    await expect(page.getByTestId("render-edit-wizard-step-label")).toHaveText(
      "Step 2 of 3 · Pricing",
    );
  });
});
