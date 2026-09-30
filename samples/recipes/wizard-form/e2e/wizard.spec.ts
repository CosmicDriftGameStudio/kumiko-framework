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

import { expect, type Page, test } from "@playwright/test";
import { expectSelectedOption, selectCombobox } from "./_helpers/select-combobox";
import { CREATED_LISTINGS_KEY, draftStorageKey } from "./fixtures/mock-dispatcher";

const DRAFT_STORAGE_PREFIX = draftStorageKey("listing-wizard:new:");

async function gotoWizard(page: Page): Promise<void> {
  await page.goto("/listing-wizard");
  await expect(page.getByTestId("render-edit-form")).toBeVisible();
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

test.describe("wizard-form — step navigation, validation, draft resume", () => {
  test("clicking Next/Back moves forward and back through all 3 steps", async ({ page }) => {
    await gotoWizard(page);

    // Step 1 — Basics
    await expect(page.getByTestId("render-edit-wizard-step-label")).toHaveText(
      "Step 1 of 3 · Basics",
    );
    await expect(page.getByTestId("render-edit-wizard-back")).toHaveCount(0);
    await page.getByTestId("field-title").locator("input").fill("Vintage desk lamp");
    await selectCombobox(page, "category", "furniture");
    await expect(page.getByTestId("field-title").locator("input")).toHaveValue("Vintage desk lamp");
    await expectSelectedOption(page, "category", "furniture");
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
    await expectSelectedOption(page, "condition", "used");
    await page.getByTestId("render-edit-wizard-next").click();

    // Step 3 — Review
    await expect(page.getByTestId("render-edit-wizard-step-label")).toHaveText(
      "Step 3 of 3 · Review",
    );
    await expect(page.getByTestId("listing-review")).toBeVisible();
    await expect(page.getByTestId("render-edit-submit")).toBeVisible();
    await expect(page.getByTestId("render-edit-wizard-next")).toHaveCount(0);
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

  test("desktop viewport shows wizard step chips with aria-current", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await gotoWizard(page);
    const step0 = page.getByTestId("render-edit-wizard-steps-step-0");
    await expect(step0).toBeVisible();
    await expect(step0).toHaveAttribute("aria-current", "step");
    await expect(page.getByTestId("render-edit-wizard-step-label")).toBeHidden();

    await page.getByTestId("field-title").locator("input").fill("Vintage desk lamp");
    await selectCombobox(page, "category", "furniture");
    await page.getByTestId("render-edit-wizard-next").click();

    await expect(page.getByTestId("render-edit-wizard-steps-step-1")).toHaveAttribute(
      "aria-current",
      "step",
    );
  });

  test("the step rail keeps its own 36px row height inside the wizard's padded chrome and follows the step", async ({
    page,
  }) => {
    // Screen-form wizards render a vertical step rail instead of the
    // progress bar. Same regression class as fw#1963/#1967 (the progress bar's
    // `h-2` used to be eaten by the chrome's padding): a rail row (`h-9`) must
    // keep its own box inside the padded chrome. A jsdom unit test can't catch
    // this (layout returns 0 there); only a real browser box model does.
    await gotoWizard(page);
    const rail = page.getByTestId("render-edit-wizard-steps");
    const step0 = page.getByTestId("render-edit-wizard-steps-step-0");
    const step1 = page.getByTestId("render-edit-wizard-steps-step-1");

    await expect(rail).toBeVisible();
    await expect(page.getByTestId("render-edit-wizard-progress")).toHaveCount(0);
    await expect(step0).toHaveAttribute("aria-current", "step");
    await expect(step0).toHaveCSS("height", "36px");
    await expect(step1).toHaveCSS("height", "36px");

    await page.getByTestId("field-title").locator("input").fill("Vintage desk lamp");
    await selectCombobox(page, "category", "furniture");
    await page.getByTestId("render-edit-wizard-next").click();

    await expect(step1).toHaveAttribute("aria-current", "step");
    await expect(step0).not.toHaveAttribute("aria-current", "step");
    await expect(step1).toHaveCSS("height", "36px");
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

  // Per-step JS validation (handleWizardNext -> controller.validate(currentStepFields))
  // blocking a middle step, not just step 1 — a real-browser twin of the
  // jsdom unit-test coverage for fw#1910.
  test("a later step's own empty required field blocks Next from advancing past it", async ({
    page,
  }) => {
    await gotoWizard(page);
    await page.getByTestId("field-title").locator("input").fill("Vintage desk lamp");
    await selectCombobox(page, "category", "furniture");
    await page.getByTestId("render-edit-wizard-next").click();
    await expect(page.getByTestId("render-edit-wizard-step-label")).toHaveText(
      "Step 2 of 3 · Pricing",
    );

    // price defaults to 0 (a valid value for a required number field) —
    // must be actively cleared to exercise the empty-required-field path,
    // not just left untouched.
    await page.getByTestId("field-price").locator("input").fill("");
    await selectCombobox(page, "condition", "new");
    await page.getByTestId("render-edit-wizard-next").click();

    // Still on step 2 — Review (step 3) stays mounted-but-hidden, same as
    // an inactive step's fields elsewhere in this spec, not visible.
    await expect(page.getByTestId("render-edit-wizard-step-label")).toHaveText(
      "Step 2 of 3 · Pricing",
    );
    await expect(page.getByTestId("listing-review")).toBeHidden();
    await expect(page.getByTestId("field-price-errors")).toBeVisible();
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
