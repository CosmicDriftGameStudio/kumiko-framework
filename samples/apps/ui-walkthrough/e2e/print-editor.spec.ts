// @runtime test
// Print styling of the PDF template editor, seen by a tenant admin of its own tenant: the address
// block as a positioned frame, text styles, the ruler, and the company data rail. Tests read the
// "Hafenkontor" tenant and save only in "Lotsenhaus" (seed-print-editor-tenants.ts); the paper
// is measured against its own bounding box because the page shrinks with the column width.

import {
  E2E_TIMEOUT_MS,
  expect,
  boundaryGuardedTest as test,
} from "@cosmicdrift/kumiko-testing/e2e";
import type { Locator, Page } from "@playwright/test";
import {
  PRINT_EDITOR_PASSWORD,
  PRINT_EDITOR_TENANTS,
  type PrintEditorTenant,
} from "../src/app/auth-constants";
import { loginAs } from "./_helpers/login";

test.use({ locale: "de-DE", viewport: { width: 1440, height: 1000 } });

const A4_WIDTH_MM = 210;
const A4_HEIGHT_MM = 297;
const FRACTION_TOLERANCE = 0.01;

const editorUrl = (slug: string): string =>
  `/pdf-template-editor?slug=${encodeURIComponent(slug)}&locale=de`;

// Tests that save a draft open the `drafts` tenant; the others only read `editor`.
async function openEditor(
  page: Page,
  slug: string,
  tenant: PrintEditorTenant = PRINT_EDITOR_TENANTS.editor,
): Promise<Locator> {
  await loginAs(page, tenant.adminEmail, PRINT_EDITOR_PASSWORD);
  await page.goto(editorUrl(slug));
  const editor = page.getByTestId("pdf-template-editor");
  await expect(editor).toBeVisible();
  const body = editor.locator('#document-designer-content[contenteditable="true"]');
  await expect(body).toBeVisible();
  return body;
}

async function boxOf(locator: Locator) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  return box as NonNullable<typeof box>;
}

async function frameBoxMm(page: Page) {
  const paper = await boxOf(page.getByTestId("document-designer-page"));
  const frame = await boxOf(page.getByTestId("document-frame"));
  const mmPerPixel = A4_WIDTH_MM / paper.width;
  return {
    paper,
    leftMm: (frame.x - paper.x) * mmPerPixel,
    topMm: (frame.y - paper.y) * mmPerPixel,
    widthMm: frame.width * mmPerPixel,
    heightMm: frame.height * mmPerPixel,
  };
}

async function fieldValue(page: Page, testId: string): Promise<number> {
  // The de-DE number input shows a decimal comma.
  return Number((await page.getByTestId(testId).inputValue()).replace(",", "."));
}

test("address block: inserted as DIN form B, moved to form A, dragged, saved and reloaded", async ({
  page,
}) => {
  const body = await openEditor(page, "billing:invoice", PRINT_EDITOR_TENANTS.drafts);
  await body.click();

  await expect(page.getByTestId("document-block-menu")).toContainText("Baustein");
  await page.getByTestId("document-block-menu").click();
  await page.getByTestId("document-block-address").click();

  const frame = page.getByTestId("document-frame");
  await expect(frame).toHaveCount(1);
  await expect(page.getByTestId("pdf-editor-frame")).toContainText("Position in mm");
  await expect(frame).toHaveAttribute("data-frame-preset", "address");
  await expect(page.getByTestId("document-frame-move")).toContainText("Form B");
  await expect(frame.locator("[data-variable-chip]").first()).toContainText("Firmenname");
  await expect(frame).not.toContainText("tenantName");

  await expect.poll(() => fieldValue(page, "frame-x")).toBe(20);
  expect(await fieldValue(page, "frame-y")).toBe(45);
  expect(await fieldValue(page, "frame-width")).toBe(85);
  expect(await fieldValue(page, "frame-height")).toBe(45);

  const initial = await frameBoxMm(page);
  expect(initial.topMm).toBeCloseTo(45, 0);
  expect(initial.widthMm).toBeCloseTo(85, 0);

  await page.getByTestId("frame-y").fill("27");
  await expect(page.getByTestId("document-frame-move")).toContainText("Form A");
  await expect
    .poll(async () => {
      const { topMm } = await frameBoxMm(page);
      return Math.abs(topMm - 27) / A4_HEIGHT_MM < FRACTION_TOLERANCE;
    })
    .toBe(true);

  const handle = await boxOf(page.getByTestId("document-frame-handle-se"));
  const startX = handle.x + handle.width / 2;
  const startY = handle.y + handle.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 60, startY + 40, { steps: 6 });
  await page.mouse.up();
  await expect.poll(() => fieldValue(page, "frame-width")).toBeGreaterThan(85);
  expect(await fieldValue(page, "frame-height")).toBeGreaterThan(45);
  await expect(page.getByTestId("document-frame-move")).toContainText("Form A");

  const saved = {
    x: await fieldValue(page, "frame-x"),
    y: await fieldValue(page, "frame-y"),
    width: await fieldValue(page, "frame-width"),
    height: await fieldValue(page, "frame-height"),
  };
  await page.getByTestId("document-designer-save").click();
  await expect(page.getByTestId("document-designer-editor-status")).toContainText("Entwurf");

  await page.reload();
  await expect(page.getByTestId("pdf-template-editor")).toBeVisible();
  const reloadedFrame = page.getByTestId("document-frame");
  await expect(reloadedFrame).toHaveCount(1);
  await expect(reloadedFrame).toHaveAttribute("data-frame-preset", "address");
  await reloadedFrame.getByTestId("document-frame-move").click();
  await expect.poll(() => fieldValue(page, "frame-y")).toBe(saved.y);
  expect(await fieldValue(page, "frame-x")).toBe(saved.x);
  expect(await fieldValue(page, "frame-width")).toBe(saved.width);
  expect(await fieldValue(page, "frame-height")).toBe(saved.height);

  const firstParagraph = page
    .getByTestId("pdf-template-editor")
    .locator('#document-designer-content[contenteditable="true"] > p')
    .first();
  const frameBox = await boxOf(reloadedFrame);
  const paragraphBox = await boxOf(firstParagraph);
  expect(paragraphBox.y).toBeGreaterThanOrEqual(frameBox.y + frameBox.height - 1);
});

const UTILITY_SLUG = "rental:utility-statement";
const MM_PER_PT = 25.4 / 72;

async function chooseToolbarOption(page: Page, testId: string, optionName: string) {
  await page.getByTestId(testId).locator("button[aria-haspopup=listbox]").click();
  await page.getByRole("option", { name: optionName, exact: true }).click();
}

test("text style: font, size, color and line height survive save and reload on the paper", async ({
  page,
}) => {
  await openEditor(page, UTILITY_SLUG, PRINT_EDITOR_TENANTS.drafts);
  // The first option of each select shows what the layout gives, not a generic "Standard".
  await expect(page.getByTestId("document-toolbar-size")).toContainText(/\d+(,\d+)? pt/);
  for (const key of ["font", "size", "line-height", "space-after"]) {
    await expect(page.getByTestId(`document-toolbar-${key}`)).not.toContainText("Standard");
  }
  const intro = page
    .getByTestId("pdf-template-editor")
    .locator('#document-designer-content[contenteditable="true"] > p', {
      hasText: "nachfolgend erhalten Sie",
    });
  await intro.click({ clickCount: 3 });

  // Each change goes through the toolbar; losing the selection after the first one would leave
  // the later styles on nothing.
  await chooseToolbarOption(page, "document-toolbar-font", "Cambria");
  await chooseToolbarOption(page, "document-toolbar-size", "14 pt");
  await page.getByTestId("document-toolbar-color").fill("#c00000");
  await chooseToolbarOption(page, "document-toolbar-line-height", "1,5");

  await page.getByTestId("document-designer-save").click();
  await expect(page.getByTestId("document-designer-editor-status")).toContainText("Entwurf");
  await page.reload();

  const reloaded = page
    .getByTestId("pdf-template-editor")
    .locator('#document-designer-content[contenteditable="true"] > p', {
      hasText: "nachfolgend erhalten Sie",
    });
  const styled = reloaded.locator("span[data-text-style]");
  await expect(styled).toHaveAttribute("data-font", "cambria");
  await expect(styled).toHaveAttribute("data-size-pt", "14");
  await expect(styled).toHaveAttribute("data-color", "#c00000");
  await expect(reloaded).toHaveAttribute("data-line-height", "1.5");

  const paper = await boxOf(page.getByTestId("document-designer-page"));
  // The editor paints the style on a decoration span inside the mark's span.
  const computed = await styled.locator("span[style]").evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      fontSize: Number.parseFloat(style.fontSize),
      color: style.color,
      font: style.fontFamily,
    };
  });
  const expectedFraction = (14 * MM_PER_PT) / A4_WIDTH_MM;
  expect(computed.fontSize / paper.width / expectedFraction).toBeCloseTo(1, 1);
  expect(computed.color).toBe("rgb(192, 0, 0)");
  expect(computed.font).toMatch(/Caladea|Cambria/);
});

test("ruler: A4 marks in centimetres and the margins of the layout", async ({ page }) => {
  await openEditor(page, UTILITY_SLUG);
  const top = page.getByTestId("page-ruler-top");
  const left = page.getByTestId("page-ruler-left");
  await expect(top.locator("[data-ruler-cm]")).toHaveCount(20);
  await expect(left.locator("[data-ruler-cm]")).toHaveCount(29);

  const topBox = await boxOf(top);
  const tenCm = await boxOf(top.locator('[data-ruler-cm="10"]'));
  expect((tenCm.x - topBox.x) / topBox.width).toBeCloseTo(100 / A4_WIDTH_MM, 2);
  const leftBox = await boxOf(left);
  const twentyCm = await boxOf(left.locator('[data-ruler-cm="20"]'));
  expect((twentyCm.y - leftBox.y) / leftBox.height).toBeCloseTo(200 / A4_HEIGHT_MM, 2);

  // The "Hafenkontor" layout sets 32 / 22 / 27 / 26 mm.
  const paper = await boxOf(page.getByTestId("document-designer-page"));
  const zoneRatio = async (side: "top" | "right" | "bottom" | "left") => {
    const zone = await boxOf(page.getByTestId(`page-ruler-margin-${side}`));
    return side === "top" || side === "bottom"
      ? zone.height / paper.height
      : zone.width / paper.width;
  };
  expect(await zoneRatio("top")).toBeCloseTo(32 / A4_HEIGHT_MM, 2);
  expect(await zoneRatio("right")).toBeCloseTo(22 / A4_WIDTH_MM, 2);
  expect(await zoneRatio("bottom")).toBeCloseTo(27 / A4_HEIGHT_MM, 2);
  expect(await zoneRatio("left")).toBeCloseTo(26 / A4_WIDTH_MM, 2);

  await expect(page.getByTestId("pdf-inherited-margins")).toContainText(
    "Aus Layout: 32 · 22 · 27 · 26",
  );
  await page.getByTestId("pdf-override-margins-open").click();
  await expect(page.getByTestId("pdf-override-margins")).toBeVisible();
  await page.locator("#dd-margin-left").fill("40");
  await expect
    .poll(async () => (await boxOf(page.getByTestId("page-ruler-margin-left"))).width / paper.width)
    .toBeCloseTo(40 / A4_WIDTH_MM, 2);

  await page.getByTestId("pdf-reset-margins").click();
  await expect(page.getByTestId("pdf-inherited-margins")).toContainText(
    "Aus Layout: 32 · 22 · 27 · 26",
  );
  await expect
    .poll(async () => (await boxOf(page.getByTestId("page-ruler-margin-left"))).width / paper.width)
    .toBeCloseTo(26 / A4_WIDTH_MM, 2);
});

test("company data: values from the settings, insert on click, value in the PDF preview", async ({
  page,
}) => {
  const body = await openEditor(page, UTILITY_SLUG);
  const rail = page.getByTestId("company-data-rail");
  await expect(rail).toContainText("Firmendaten");
  // In the template the rail shows what the text uses, not the values of the settings.
  const companyBox = await boxOf(rail);
  const systemBox = await boxOf(page.getByTestId("pdf-editor-system-placeholders"));
  expect(companyBox.y).toBeLessThan(systemBox.y);
  await expect(page.getByTestId("pdf-editor-placeholders")).not.toContainText("tenantName");
  await expect(page.getByTestId("pdf-editor-system-placeholders")).not.toContainText("Firmenname");
  await expect(page.getByTestId("pdf-system-tenantName")).toHaveCount(0);
  await expect(rail.getByTestId("company-data-tenantName")).toContainText("Firmenname");
  await expect(rail.getByTestId("company-data-companyIban")).toContainText("–");
  await expect(rail.getByTestId("company-data-companyIban")).not.toContainText("DE89");

  await body.locator("> p").last().click();
  const chips = page.getByTestId("pdf-template-editor").locator("[data-variable-chip]");
  const before = await chips.count();
  await rail.getByTestId("company-data-companyIban").click();
  await expect(chips).toHaveCount(before + 1);
  await expect(rail.getByTestId("company-data-companyIban")).toContainText("✓");

  await page.getByTestId("pdf-mode-switch").getByText("Vorschau", { exact: true }).click();
  await expect(page.getByTestId("document-designer-pdf-preview")).toBeVisible({
    timeout: E2E_TIMEOUT_MS.poll,
  });
  await expect(page.getByTestId("pdf-page-1")).toContainText("DE89 3704 0044 0532 0130 00");
});

test("address block: the recipient typed into the frame shows in the PDF preview", async ({
  page,
}) => {
  const body = await openEditor(page, UTILITY_SLUG);
  await body.click();
  await page.getByTestId("document-block-menu").click();
  await page.getByTestId("document-block-address").click();
  const frame = page.getByTestId("document-frame");
  await frame.locator("p").last().click();
  await page.keyboard.type("Erika Musterfrau");
  await expect(frame).toContainText("Erika Musterfrau");

  await page.getByTestId("pdf-mode-switch").getByText("Vorschau", { exact: true }).click();
  await expect(page.getByTestId("pdf-page-1")).toContainText("Erika Musterfrau", {
    timeout: E2E_TIMEOUT_MS.poll,
  });
});

test("empty document: clearing the text keeps the editor usable", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const body = await openEditor(page, UTILITY_SLUG);
  await body.click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.press("Backspace");
  await expect(body).toBeVisible();
  await page.keyboard.type("Neuer Text");
  await expect(body).toContainText("Neuer Text");
  await page.getByTestId("document-block-menu").click();
  await page.getByTestId("document-block-textframe").click();
  await expect(page.getByTestId("document-frame")).toHaveCount(1);
  expect(pageErrors).toEqual([]);
});

test("toolbar: every print control stays inside the toolbar at 1280 px", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openEditor(page, UTILITY_SLUG);
  const row = page.getByTestId("document-toolbar-font").locator("xpath=../..");
  const rowBox = await boxOf(row);
  for (const key of ["font", "size", "line-height", "space-after"]) {
    const box = await boxOf(page.getByTestId(`document-toolbar-${key}`));
    expect(box.x + box.width).toBeLessThanOrEqual(rowBox.x + rowBox.width + 0.5);
  }
  await expect(page.getByTestId("document-toolbar-space-after")).toBeInViewport({ ratio: 1 });
});

test("frame: eight handles while selected, none after a click into the text", async ({ page }) => {
  const body = await openEditor(page, "rental:tenancy-certificate");
  await body.click();
  await page.getByTestId("document-block-menu").click();
  await page.getByTestId("document-block-address").click();
  const frame = page.getByTestId("document-frame");
  await expect(frame).toHaveAttribute("data-frame-selected", "");
  const visibleHandles = page.locator('[data-testid^="document-frame-handle-"]:visible');
  await expect(visibleHandles).toHaveCount(8);

  await body.locator("> p").last().click();
  await expect(frame).not.toHaveAttribute("data-frame-selected", "");
  await expect(visibleHandles).toHaveCount(0);
});

test("text frame: the default box leaves the first flow text where it was", async ({ page }) => {
  const body = await openEditor(page, "rental:property-expose");
  const firstText = body.locator("> p").first();
  await body.click();
  const before = await boxOf(firstText);
  await page.getByTestId("document-block-menu").click();
  await page.getByTestId("document-block-textframe").click();
  await expect(page.getByTestId("document-frame")).toHaveCount(1);
  const after = await boxOf(body.locator("> p").first());
  expect(Math.abs(after.y - before.y)).toBeLessThan(2);
});

test("address block: the sender checkbox controls the line below the sender", async ({ page }) => {
  const body = await openEditor(page, "rental:tenancy-certificate");
  await body.click();
  await page.getByTestId("document-block-menu").click();
  await page.getByTestId("document-block-address").click();
  const frame = page.getByTestId("document-frame");
  const firstParagraph = frame.locator("p").first();
  await expect(firstParagraph).toHaveCSS("border-bottom-width", "1px");

  await page.getByTestId("frame-sender").getByRole("checkbox").uncheck();
  await expect(frame.locator("p").first()).not.toHaveCSS("border-bottom-width", "1px");
});

test("block menu: every entry carries a description", async ({ page }) => {
  await openEditor(page, "billing:invoice");
  await page.getByTestId("document-block-menu").click();
  for (const id of ["address", "textframe", "columns"]) {
    const item = page.getByTestId(`document-block-${id}`);
    await expect(item).toBeVisible();
    await expect(item.locator("span.text-muted-foreground")).not.toBeEmpty();
  }
});

test("table strip: toggles the repeated header row", async ({ page }) => {
  await openEditor(page, "billing:invoice");
  const strip = page.getByTestId("document-repeat-strip").first();
  await expect(strip).toBeVisible();
  await expect(strip).toContainText("Wiederholung");
  const toggle = page.getByTestId("document-repeat-header-toggle").first();
  const pressed = await toggle.getAttribute("aria-pressed");
  await toggle.click();
  await expect(toggle).not.toHaveAttribute("aria-pressed", pressed ?? "false");
});

test("preview: the invoice shows exactly the two example position rows", async ({ page }) => {
  await openEditor(page, "billing:invoice");
  await page.getByTestId("pdf-mode-switch").getByText("Vorschau", { exact: true }).click();
  const sheet = page.getByTestId("pdf-page-1");
  await expect(sheet).toBeVisible({ timeout: E2E_TIMEOUT_MS.poll });
  await expect(sheet.locator("span").filter({ hasText: "Stellplatz 7" }).first()).toBeVisible();
  await expect(sheet.locator("span").filter({ hasText: /\[(Nr\.|Bezeichnung)\]/ })).toHaveCount(0);
});

const SNAP_NEAR_MM = 1;

async function insertAddressAndTextFrame(page: Page): Promise<void> {
  const body = await openEditor(page, "rental:property-expose");
  await body.click();
  await page.getByTestId("document-block-menu").click();
  await page.getByTestId("document-block-address").click();
  await expect(page.getByTestId("document-frame")).toHaveCount(1);
  await page.getByTestId("document-block-menu").click();
  await page.getByTestId("document-block-textframe").click();
  await expect(page.getByTestId("document-frame")).toHaveCount(2);
}

async function dragFromCenter(page: Page, target: Locator, dxPx: number): Promise<void> {
  const box = await boxOf(target);
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + dxPx, startY, { steps: 6 });
  await page.mouse.up();
}

test("frames: the width snaps to the width of the other frame while resizing", async ({ page }) => {
  await insertAddressAndTextFrame(page);
  const paper = await boxOf(page.getByTestId("document-designer-page"));
  const pxPerMm = paper.width / A4_WIDTH_MM;
  const textFrame = page.getByTestId("document-frame").nth(1);
  await expect.poll(() => fieldValue(page, "frame-width")).toBe(65);

  // The drag ends 1 mm short of the address field's 85 mm width.
  const dragMm = 85 - 65 - SNAP_NEAR_MM;
  await dragFromCenter(page, textFrame.getByTestId("document-frame-handle-e"), dragMm * pxPerMm);
  await expect.poll(() => fieldValue(page, "frame-width")).toBe(85);
});

test("frames: the left edge snaps to the edge of the other frame while moving", async ({
  page,
}) => {
  await insertAddressAndTextFrame(page);
  const paper = await boxOf(page.getByTestId("document-designer-page"));
  const pxPerMm = paper.width / A4_WIDTH_MM;
  const textFrame = page.getByTestId("document-frame").nth(1);
  await expect.poll(() => fieldValue(page, "frame-x")).toBe(125);

  // The left edge ends 1 mm right of the address field's 20 mm.
  const dragMm = 125 - 20 - SNAP_NEAR_MM;
  await dragFromCenter(page, textFrame.getByTestId("document-frame-move"), -dragMm * pxPerMm);
  await expect.poll(() => fieldValue(page, "frame-x")).toBe(20);
});
