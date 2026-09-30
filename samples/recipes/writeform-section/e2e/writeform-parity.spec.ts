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

  // The entityEdit form's footer is a bar spanning the whole screen,
  // while the writeForm section's Save stays in the section header above its
  // fields column. Both must sit at the right edge of their own frame: the
  // footer bar for entityEdit, the fields column for the section.
  test("entityEdit submit sits right-aligned in its footer, the writeForm submit at the right edge of its fields column", async ({
    page,
  }) => {
    await gotoBothForms(page);

    const establishedBox = await establishedSubmit(page).boundingBox();
    const establishedForm = await closestFormRect(establishedSubmit(page));
    if (establishedBox === null) {
      throw new Error("writeform-parity: submit button has no bounding box");
    }
    const establishedGap = establishedForm.right - (establishedBox.x + establishedBox.width);
    expect(establishedGap).toBeLessThan(establishedForm.width * 0.2);

    const writeFormBox = await writeFormSubmit(page).boundingBox();
    const fieldsBox = await page
      .getByTestId("write-form-screen")
      .getByTestId("field-title")
      .boundingBox();
    if (writeFormBox === null || fieldsBox === null) {
      throw new Error("writeform-parity: submit button or fields column has no bounding box");
    }
    const writeFormGap = fieldsBox.x + fieldsBox.width - (writeFormBox.x + writeFormBox.width);
    expect(Math.abs(writeFormGap)).toBeLessThanOrEqual(4);
  });

  test("both submit buttons are text-only, no icon on either", async ({ page }) => {
    await gotoBothForms(page);
    await expect(establishedSubmit(page)).toBeVisible();
    await expect(writeFormSubmit(page)).toBeVisible();
    expect(await establishedSubmit(page).locator("svg").count()).toBe(0);
    expect(await writeFormSubmit(page).locator("svg").count()).toBe(0);
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
