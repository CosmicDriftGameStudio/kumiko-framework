// Wizard Form Sample — E2E
//
// Boots the real client bundle (real React tree, real `EditLayout.mode:
// "wizard"` step transitions, real form-draft save/resume wiring in
// RenderEdit) against a MockDispatcher — see e2e/build-server.ts +
// e2e/fixtures/*. Proves what an integration test against the handler
// contract can't: that a user can actually click through the wizard, that
// a blocked step really keeps its error on screen instead of advancing,
// and that a page reload resumes exactly where the draft left off.
//
// draftKey for create-mode = `${screen.id}:new:${draftId}` (issue #1913) —
// `draftId` is a client-minted UUID (see render-edit.tsx's `draftKey`
// useMemo), so this spec matches on the `listing-wizard:new:` prefix
// rather than a single literal key.

import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { CREATED_LISTINGS_KEY, draftStorageKey } from "./fixtures/mock-dispatcher";

const SCREENSHOT_DIR = resolve(import.meta.dirname, "../screenshots");
const DRAFT_STORAGE_PREFIX = draftStorageKey("listing-wizard:new:");

async function gotoWizard(page: Page): Promise<void> {
  await page.goto("/listing-wizard");
  await expect(page.getByTestId("render-edit-form")).toBeVisible();
}

async function selectCombobox(page: Page, field: string, optionLabel: string): Promise<void> {
  await page.getByTestId(`combobox-kumiko-edit-${field}`).click();
  await page.getByRole("option", { name: optionLabel, exact: true }).click();
}

async function draftInStorage(page: Page): Promise<unknown> {
  // The draftId is a client-minted UUID (issue #1913), unknown ahead of
  // time — scan for the one key under this screen's create-mode prefix
  // instead of matching a fixed key.
  return page.evaluate((prefix) => {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key?.startsWith(prefix)) return localStorage.getItem(key);
    }
    return null;
  }, DRAFT_STORAGE_PREFIX);
}

async function createdListings(page: Page): Promise<Record<string, unknown>[]> {
  const raw = await page.evaluate((key) => localStorage.getItem(key), CREATED_LISTINGS_KEY);
  return raw === null ? [] : (JSON.parse(raw) as Record<string, unknown>[]);
}

// Derives the expected fill ratio from the step label's own "Step X of Y"
// text instead of a hardcoded literal (fw#1970) — so adding/removing a
// wizard step doesn't break this on an unrelated number mismatch.
async function expectStepFillRatio(
  progress: Locator,
  fill: Locator,
  stepLabel: Locator,
): Promise<void> {
  const label = await stepLabel.textContent();
  const match = label?.match(/Step (\d+) of (\d+)/);
  expect(match, `step label "${label}" doesn't match "Step X of Y"`).not.toBeNull();
  const [, currentStr, totalStr] = match!;
  const expectedRatio = Number(currentStr) / Number(totalStr);

  const wrapperBox = await progress.boundingBox();
  const fillBox = await fill.boundingBox();
  expect(wrapperBox).not.toBeNull();
  expect(fillBox).not.toBeNull();
  const actualRatio = fillBox!.width / wrapperBox!.width;
  const tolerance = 0.03;
  expect(actualRatio).toBeGreaterThan(expectedRatio - tolerance);
  expect(actualRatio).toBeLessThan(expectedRatio + tolerance);
}

test.describe("wizard-form — step navigation, validation, draft resume", () => {
  test("clicking Next/Back moves forward and back through all 3 steps", async ({ page }) => {
    mkdirSync(SCREENSHOT_DIR, { recursive: true });
    await gotoWizard(page);

    // Step 1 — Basics
    await expect(page.getByTestId("render-edit-wizard-step-label")).toHaveText(
      "Step 1 of 3 · Basics",
    );
    await expect(page.getByTestId("render-edit-wizard-back")).toHaveCount(0);
    await page.getByTestId("field-title").locator("input").fill("Vintage desk lamp");
    await selectCombobox(page, "category", "furniture");
    await expect(page.getByTestId("field-title").locator("input")).toHaveValue("Vintage desk lamp");
    await expect(page.getByTestId("combobox-kumiko-edit-category")).toContainText("furniture");
    await page.screenshot({ path: resolve(SCREENSHOT_DIR, "step-1-basics.png") });

    await page.getByTestId("render-edit-wizard-next").click();

    // Step 2 — Pricing
    await expect(page.getByTestId("render-edit-wizard-step-label")).toHaveText(
      "Step 2 of 3 · Pricing",
    );
    // Regression for the `hidden` prop fix in primitives/index.tsx's
    // DefaultSection: the prop used to be accepted but never wired into the
    // DOM at all, so an inactive step stayed fully visible/interactive.
    // toBeHidden() checks computed CSS visibility, not just DOM attributes.
    await expect(page.getByTestId("field-title")).toBeHidden();
    await page.getByTestId("field-price").locator("input").fill("42");
    await selectCombobox(page, "condition", "used");
    await expect(page.getByTestId("field-price").locator("input")).toHaveValue("42");
    await expect(page.getByTestId("combobox-kumiko-edit-condition")).toContainText("used");
    await page.screenshot({ path: resolve(SCREENSHOT_DIR, "step-2-pricing.png") });

    await page.getByTestId("render-edit-wizard-next").click();

    // Step 3 — Review
    await expect(page.getByTestId("render-edit-wizard-step-label")).toHaveText(
      "Step 3 of 3 · Review",
    );
    await expect(page.getByTestId("listing-review")).toBeVisible();
    await expect(page.getByTestId("render-edit-submit")).toBeVisible();
    await expect(page.getByTestId("render-edit-wizard-next")).toHaveCount(0);
    await page.screenshot({ path: resolve(SCREENSHOT_DIR, "step-3-review.png") });

    // Back to Pricing, back to Basics.
    await page.getByTestId("render-edit-wizard-back").click();
    await expect(page.getByTestId("render-edit-wizard-step-label")).toHaveText(
      "Step 2 of 3 · Pricing",
    );
    await page.getByTestId("render-edit-wizard-back").click();
    await expect(page.getByTestId("render-edit-wizard-step-label")).toHaveText(
      "Step 1 of 3 · Basics",
    );
  });

  test("the progress bar keeps its own 8px height inside the wizard's padded chrome", async ({
    page,
  }) => {
    // Regression for fw#1963/#1967: RenderEdit's wizard chrome pads every
    // direct child of the form body (`[&>:not(section)]:py-3`, first-child
    // `pt-6`) — with `box-sizing: border-box` that padding used to consume
    // the progress bar's `h-2` entirely, rendering a ~36px bar instead of
    // 8px. A jsdom unit test can't catch this (layout returns 0 there);
    // only a real browser box model does.
    await gotoWizard(page);
    const progress = page.getByTestId("render-edit-wizard-progress");
    const fill = progress.locator("> div");
    const stepLabel = page.getByTestId("render-edit-wizard-step-label");

    // `fill` is `absolute inset-y-0` inside `progress` — once the track's
    // own height is confirmed, the fill's height follows by construction;
    // asserting it separately would only catch a regression this test
    // doesn't otherwise already fail on.
    await expect(progress).toHaveCSS("height", "8px");
    await expectStepFillRatio(progress, fill, stepLabel);

    await page.getByTestId("field-title").locator("input").fill("Vintage desk lamp");
    await selectCombobox(page, "category", "furniture");
    await page.getByTestId("render-edit-wizard-next").click();
    await expect(stepLabel).toHaveText("Step 2 of 3 · Pricing");

    await expect(progress).toHaveCSS("height", "8px");
    await expectStepFillRatio(progress, fill, stepLabel);
  });

  test("an empty required field blocks Next and shows a field error", async ({ page }) => {
    await gotoWizard(page);
    // Fill category (also required) so the block is attributable to title
    // alone, not "any required field in the step is empty".
    await selectCombobox(page, "category", "electronics");

    await page.getByTestId("render-edit-wizard-next").click();

    await expect(page.getByTestId("field-title-errors")).toBeVisible();
    await expect(page.getByTestId("field-title-errors")).toHaveAttribute("role", "alert");
    await expect(page.getByTestId("render-edit-wizard-step-label")).toHaveText(
      "Step 1 of 3 · Basics",
    );
  });

  test("values survive navigating back to a previous step", async ({ page }) => {
    await gotoWizard(page);
    await page.getByTestId("field-title").locator("input").fill("Old bicycle");
    await selectCombobox(page, "category", "vehicles");
    await page.getByTestId("render-edit-wizard-next").click();
    await expect(page.getByTestId("render-edit-wizard-step-label")).toHaveText(
      "Step 2 of 3 · Pricing",
    );

    await page.getByTestId("render-edit-wizard-back").click();

    await expect(page.getByTestId("render-edit-wizard-step-label")).toHaveText(
      "Step 1 of 3 · Basics",
    );
    await expect(page.getByTestId("field-title").locator("input")).toHaveValue("Old bicycle");
  });

  test("a reload mid-wizard resumes at the same step with the same values", async ({ page }) => {
    await gotoWizard(page);
    await page.getByTestId("field-title").locator("input").fill("Draft desk lamp");
    await selectCombobox(page, "category", "furniture");
    await page.getByTestId("render-edit-wizard-next").click();
    // saveDraft() is fire-and-forget (`void dispatcher.write(...)` in
    // render-edit.tsx) — wait for the step to actually change before
    // reloading so the reload doesn't race an in-flight draft save.
    await expect(page.getByTestId("render-edit-wizard-step-label")).toHaveText(
      "Step 2 of 3 · Pricing",
    );

    await page.reload();

    await expect(page.getByTestId("render-edit-form")).toBeVisible();
    await expect(page.getByTestId("render-edit-wizard-step-label")).toHaveText(
      "Step 2 of 3 · Pricing",
    );
    await page.getByTestId("render-edit-wizard-back").click();
    await expect(page.getByTestId("field-title").locator("input")).toHaveValue("Draft desk lamp");
  });

  test("submit creates the listing and discards the draft — reopening starts fresh", async ({
    page,
  }) => {
    await gotoWizard(page);
    await page.getByTestId("field-title").locator("input").fill("Submit test lamp");
    await selectCombobox(page, "category", "furniture");
    await page.getByTestId("render-edit-wizard-next").click();
    await expect(page.getByTestId("render-edit-wizard-step-label")).toHaveText(
      "Step 2 of 3 · Pricing",
    );

    await page.getByTestId("field-price").locator("input").fill("99");
    await selectCombobox(page, "condition", "new");
    await page.getByTestId("render-edit-wizard-next").click();
    await expect(page.getByTestId("render-edit-wizard-step-label")).toHaveText(
      "Step 3 of 3 · Review",
    );

    await expect.poll(() => draftInStorage(page)).not.toBeNull();
    await page.getByTestId("render-edit-submit").click();
    // discardDraft() is awaited before onSubmit fires (render-edit.tsx:
    // `await discardDraft()` runs before `onSubmit?.(result)`) — poll
    // localStorage directly instead of a UI signal, this recipe registers
    // no entityList screen so there's no post-submit navigation to wait out.
    await expect.poll(() => draftInStorage(page)).toBeNull();

    // The create payload actually reached the dispatcher with values
    // accumulated across all three steps — not just that the draft got
    // discarded (discard also fires on a failed write in other flows).
    const listings = await createdListings(page);
    expect(listings).toHaveLength(1);
    expect(listings[0]).toMatchObject({
      title: "Submit test lamp",
      category: "furniture",
      price: 99,
      condition: "new",
    });

    await page.reload();

    await expect(page.getByTestId("render-edit-wizard-step-label")).toHaveText(
      "Step 1 of 3 · Basics",
    );
    await expect(page.getByTestId("field-title").locator("input")).toHaveValue("");
  });
});
