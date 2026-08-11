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

import { mkdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { expect, type Page, test } from "@playwright/test";

const SCREENSHOT_DIR = resolve(import.meta.dirname, "../screenshots");
const DRAFT_STORAGE_PREFIX = "mock-form-draft:listing-wizard:new:";

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
      if (key !== null && key.startsWith(prefix)) return localStorage.getItem(key);
    }
    return null;
  }, DRAFT_STORAGE_PREFIX);
}

async function createdListings(page: Page): Promise<Record<string, unknown>[]> {
  const raw = await page.evaluate(() => localStorage.getItem("mock-created-listings"));
  return raw === null ? [] : (JSON.parse(raw) as Record<string, unknown>[]);
}

test.describe("wizard-form — step navigation, validation, draft resume", () => {
  test("clicking Next/Back moves forward and back through all 3 steps", async ({ page }) => {
    mkdirSync(SCREENSHOT_DIR, { recursive: true });
    await gotoWizard(page);

    // Step 1 — Basics
    await expect(page.getByTestId("render-edit-wizard-step-label")).toHaveText("Step 1 of 3");
    await expect(page.getByTestId("render-edit-wizard-back")).toHaveCount(0);
    await page.getByTestId("field-title").locator("input").fill("Vintage desk lamp");
    await selectCombobox(page, "category", "furniture");
    await page.screenshot({ path: resolve(SCREENSHOT_DIR, "step-1-basics.png") });

    await page.getByTestId("render-edit-wizard-next").click();

    // Step 2 — Pricing
    await expect(page.getByTestId("render-edit-wizard-step-label")).toHaveText("Step 2 of 3");
    await page.getByTestId("field-price").locator("input").fill("42");
    await selectCombobox(page, "condition", "used");
    await page.screenshot({ path: resolve(SCREENSHOT_DIR, "step-2-pricing.png") });

    await page.getByTestId("render-edit-wizard-next").click();

    // Step 3 — Review
    await expect(page.getByTestId("render-edit-wizard-step-label")).toHaveText("Step 3 of 3");
    await expect(page.getByTestId("listing-review")).toBeVisible();
    await expect(page.getByTestId("render-edit-submit")).toBeVisible();
    await expect(page.getByTestId("render-edit-wizard-next")).toHaveCount(0);
    await page.screenshot({ path: resolve(SCREENSHOT_DIR, "step-3-review.png") });

    // Back to Pricing, back to Basics.
    await page.getByTestId("render-edit-wizard-back").click();
    await expect(page.getByTestId("render-edit-wizard-step-label")).toHaveText("Step 2 of 3");
    await page.getByTestId("render-edit-wizard-back").click();
    await expect(page.getByTestId("render-edit-wizard-step-label")).toHaveText("Step 1 of 3");

    for (const name of ["step-1-basics.png", "step-2-pricing.png", "step-3-review.png"]) {
      expect(statSync(resolve(SCREENSHOT_DIR, name)).size).toBeGreaterThan(1024);
    }
  });

  test("an empty required field blocks Next and shows a field error", async ({ page }) => {
    await gotoWizard(page);
    // Fill category (also required) so the block is attributable to title
    // alone, not "any required field in the step is empty".
    await selectCombobox(page, "category", "electronics");

    await page.getByTestId("render-edit-wizard-next").click();

    await expect(page.getByTestId("field-title-errors")).toBeVisible();
    await expect(page.getByTestId("field-title-errors")).toHaveAttribute("role", "alert");
    await expect(page.getByTestId("render-edit-wizard-step-label")).toHaveText("Step 1 of 3");
  });

  test("values survive navigating back to a previous step", async ({ page }) => {
    await gotoWizard(page);
    await page.getByTestId("field-title").locator("input").fill("Old bicycle");
    await selectCombobox(page, "category", "vehicles");
    await page.getByTestId("render-edit-wizard-next").click();
    await expect(page.getByTestId("render-edit-wizard-step-label")).toHaveText("Step 2 of 3");

    await page.getByTestId("render-edit-wizard-back").click();

    await expect(page.getByTestId("render-edit-wizard-step-label")).toHaveText("Step 1 of 3");
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
    await expect(page.getByTestId("render-edit-wizard-step-label")).toHaveText("Step 2 of 3");

    await page.reload();

    await expect(page.getByTestId("render-edit-form")).toBeVisible();
    await expect(page.getByTestId("render-edit-wizard-step-label")).toHaveText("Step 2 of 3");
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
    await expect(page.getByTestId("render-edit-wizard-step-label")).toHaveText("Step 2 of 3");

    await page.getByTestId("field-price").locator("input").fill("99");
    await selectCombobox(page, "condition", "new");
    await page.getByTestId("render-edit-wizard-next").click();
    await expect(page.getByTestId("render-edit-wizard-step-label")).toHaveText("Step 3 of 3");

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

    await expect(page.getByTestId("render-edit-wizard-step-label")).toHaveText("Step 1 of 3");
    await expect(page.getByTestId("field-title").locator("input")).toHaveValue("");
  });
});
