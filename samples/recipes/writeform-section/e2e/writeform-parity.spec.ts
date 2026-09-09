// Layout-parity spec (fw#2680): renders the projectionDetail `writeForm`
// section next to the established `entityEdit` form for the same fields
// (see fixtures/client.tsx's SideBySideShell) and measures both submit
// buttons + footers from the SAME page load. No hardcoded pixel positions
// — every assertion is a comparison between the two live box models, so it
// catches a layout regression (fw#2681: inline, full-width writeForm
// button instead of the established right-aligned footer treatment)
// without depending on a screenshot baseline.

import { mkdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { CREATED_COMMENTS_KEY } from "./fixtures/mock-dispatcher";

const SCREENSHOT_DIR =
  process.env["SCREENSHOT_DIR"] ?? resolve(import.meta.dirname, "../screenshots");

async function gotoBothForms(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByTestId("established-form")).toBeVisible();
  await expect(page.getByTestId("write-form-screen")).toBeVisible();
  // The established entityEdit form's submit is disabled until
  // snapshot.isUnchanged flips to false. Typing into the empty create-mode
  // field makes the form dirty so both submits are measured and screenshot
  // in the same enabled state.
  await page
    .getByTestId("established-form")
    .getByTestId("field-title")
    .locator("input")
    .fill("Sample note");
}

function establishedSubmit(page: Page): Locator {
  return page.getByTestId("established-form").getByTestId("render-edit-submit");
}

function writeFormSubmit(page: Page): Locator {
  return page.getByTestId("write-form-screen").getByTestId("write-form-section-submit");
}

async function closestFormRect(
  locator: Locator,
): Promise<{ readonly left: number; readonly right: number; readonly width: number }> {
  const rect = await locator.evaluate((el) => {
    const form = el.closest("form");
    if (form === null) return null;
    const r = form.getBoundingClientRect();
    return { left: r.left, right: r.right, width: r.width };
  });
  if (rect === null) throw new Error("writeform-parity: button has no ancestor <form>");
  return rect;
}

test.describe("writeform-section — layout parity with the established entityEdit form", () => {
  test("both submit buttons are visible", async ({ page }) => {
    await gotoBothForms(page);
    await expect(establishedSubmit(page)).toBeVisible();
    await expect(writeFormSubmit(page)).toBeVisible();
  });

  test("both submit buttons render the same width — same label, same icon, same Button primitive", async ({
    page,
  }) => {
    await gotoBothForms(page);
    const established = await establishedSubmit(page).boundingBox();
    const writeForm = await writeFormSubmit(page).boundingBox();
    if (established === null || writeForm === null) {
      throw new Error("writeform-parity: submit button has no bounding box");
    }
    expect(Math.abs(established.width - writeForm.width)).toBeLessThanOrEqual(2);
  });

  test("neither submit button stretches full-width inside its form", async ({ page }) => {
    await gotoBothForms(page);
    for (const submit of [establishedSubmit(page), writeFormSubmit(page)]) {
      const box = await submit.boundingBox();
      const formRect = await closestFormRect(submit);
      if (box === null) throw new Error("writeform-parity: submit button has no bounding box");
      expect(box.width / formRect.width).toBeLessThan(0.5);
    }
  });

  test("both submit buttons sit right-aligned in their form's footer, within 4px of each other", async ({
    page,
  }) => {
    await gotoBothForms(page);
    const gaps: number[] = [];
    for (const submit of [establishedSubmit(page), writeFormSubmit(page)]) {
      const box = await submit.boundingBox();
      const formRect = await closestFormRect(submit);
      if (box === null) throw new Error("writeform-parity: submit button has no bounding box");
      const rightGap = formRect.right - (box.x + box.width);
      expect(rightGap).toBeLessThan(formRect.width * 0.2);
      gaps.push(rightGap);
    }
    const [establishedGap, writeFormGap] = gaps as [number, number];
    expect(Math.abs(establishedGap - writeFormGap)).toBeLessThanOrEqual(4);
  });

  test("both submit buttons carry an icon", async ({ page }) => {
    await gotoBothForms(page);
    await expect(establishedSubmit(page).locator("svg").first()).toBeVisible();
    expect(await establishedSubmit(page).locator("svg").count()).toBeGreaterThanOrEqual(1);
    await expect(writeFormSubmit(page).locator("svg").first()).toBeVisible();
    expect(await writeFormSubmit(page).locator("svg").count()).toBeGreaterThanOrEqual(1);
  });

  test("submitting the writeForm section dispatches the entered values to its own handler", async ({
    page,
  }) => {
    await gotoBothForms(page);
    const writeFormScreen = page.getByTestId("write-form-screen");
    await writeFormScreen.getByTestId("field-title").locator("input").fill("Layout looks off");
    await writeFormScreen
      .getByTestId("field-body")
      .locator("input")
      .fill("Save button is full-width.");
    await writeFormSubmit(page).click();

    await expect
      .poll(() => page.evaluate((key) => localStorage.getItem(key), CREATED_COMMENTS_KEY))
      .not.toBeNull();

    const comments = await page.evaluate((key) => {
      const raw = localStorage.getItem(key);
      return raw === null ? [] : (JSON.parse(raw) as Record<string, unknown>[]);
    }, CREATED_COMMENTS_KEY);
    expect(comments).toHaveLength(1);
    expect(comments[0]).toMatchObject({
      title: "Layout looks off",
      body: "Save button is full-width.",
    });
  });

  test("writeForm section beside the established entityEdit form", async ({ page }) => {
    await gotoBothForms(page);
    mkdirSync(SCREENSHOT_DIR, { recursive: true });
    const path = resolve(SCREENSHOT_DIR, "writeform-vs-entityedit.png");
    // animations: "disabled" jumps to end-state at the engine level — immune to CSS specificity, unlike an addStyleTag injection
    await page.screenshot({ path, fullPage: true, animations: "disabled" });
    expect(statSync(path).size).toBeGreaterThan(5 * 1024);
  });
});
