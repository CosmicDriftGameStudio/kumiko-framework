// @runtime test
// Where header, footer and ruler sit on the editor paper, measured in millimetres against the
// paper element and compared with the PDF preview of the same template. The text line's top is
// taken from the text range, not the block box, because the PDF places lines, not boxes.

import {
  E2E_TIMEOUT_MS,
  expect,
  boundaryGuardedTest as test,
} from "@cosmicdrift/kumiko-testing/e2e";
import type { Locator, Page } from "@playwright/test";
import { PRINT_EDITOR_PASSWORD, PRINT_EDITOR_TENANTS } from "../src/app/auth-constants";
import { loginAs } from "./_helpers/login";

test.use({ locale: "de-DE", viewport: { width: 1440, height: 1000 } });

const A4_HEIGHT_MM = 297;
const PDF_MATCH_TOLERANCE_MM = 2;
const FOOTER_STABLE_TOLERANCE_MM = 0.5;
const HEADER_TEXT = "Am Hafen 12 · 24103 Kiel";
const FOOTER_TEXT = "DE89";
// A template no other spec saves a draft for, so the preview shows the plain layout.
const TEMPLATE_URL = "/pdf-template-editor?slug=rental%3Atenancy-certificate&locale=de";
const LAYOUT_URL = "/layout-editor?kind=pdf-layout&slug=default";
const LONG_PARAGRAPH_LINES = 45;
const HEADER_REGION_MAX_TOP_MM = 5;

async function editorTextTopMm(page: Page, paperTestId: string, text: string): Promise<number> {
  const paper = page.getByTestId(paperTestId);
  await expect(paper).toContainText(text);
  const topMm = await paper.evaluate((paperElement, needle) => {
    const widthMm = Number(paperElement.getAttribute("data-paper-width-mm"));
    const paperBox = paperElement.getBoundingClientRect();
    const walker = document.createTreeWalker(paperElement, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const at = (node.textContent ?? "").indexOf(needle);
      if (at < 0) continue;
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + needle.length);
      const rect = range.getClientRects()[0];
      if (rect === undefined) continue;
      return ((rect.top - paperBox.top) * widthMm) / paperBox.width;
    }
    return null;
  }, text);
  expect(topMm).not.toBeNull();
  return topMm as number;
}

async function pdfTextTopMm(page: Page, text: string): Promise<number> {
  const span: Locator = page.getByTestId("pdf-page-1").locator("span").filter({ hasText: text });
  await expect(span.first()).toBeVisible({ timeout: E2E_TIMEOUT_MS.poll });
  // The same words can recur lower on the page (sender line above the address); the region text is the topmost.
  const topPercent = await span.evaluateAll((elements) =>
    Math.min(...elements.map((element) => parseFloat((element as HTMLElement).style.top))),
  );
  return (topPercent / 100) * A4_HEIGHT_MM;
}

async function openTemplateEditor(page: Page): Promise<void> {
  await loginAs(page, PRINT_EDITOR_TENANTS.editor.adminEmail, PRINT_EDITOR_PASSWORD);
  await page.goto(TEMPLATE_URL);
  await expect(page.getByTestId("pdf-template-editor")).toBeVisible();
  await expect(
    page
      .getByTestId("pdf-template-editor")
      .locator('#document-designer-content[contenteditable="true"]'),
  ).toBeVisible();
}

async function showPreview(page: Page): Promise<void> {
  await page.getByTestId("pdf-mode-switch").getByText("Vorschau", { exact: true }).click();
}

test("template editor: footer and header text sit where the PDF prints them", async ({ page }) => {
  await openTemplateEditor(page);
  const editorFooterTop = await editorTextTopMm(page, "document-designer-page", FOOTER_TEXT);
  const editorHeaderTop = await editorTextTopMm(page, "document-designer-page", HEADER_TEXT);

  await showPreview(page);
  const pdfFooterTop = await pdfTextTopMm(page, FOOTER_TEXT);
  const pdfHeaderTop = await pdfTextTopMm(page, "Am Hafen");

  expect(Math.abs(editorFooterTop - pdfFooterTop)).toBeLessThanOrEqual(PDF_MATCH_TOLERANCE_MM);
  expect(Math.abs(editorHeaderTop - pdfHeaderTop)).toBeLessThanOrEqual(PDF_MATCH_TOLERANCE_MM);
});

test("template editor: the footer stays put when a long paragraph is inserted", async ({
  page,
}) => {
  await openTemplateEditor(page);
  const before = await editorTextTopMm(page, "document-designer-page", FOOTER_TEXT);

  const body = page
    .getByTestId("pdf-template-editor")
    .locator('#document-designer-content[contenteditable="true"]');
  await body.click();
  for (let line = 1; line <= LONG_PARAGRAPH_LINES; line++) {
    await page.keyboard.type(`Absatz ${line}`);
    await page.keyboard.press("Enter");
  }

  const after = await editorTextTopMm(page, "document-designer-page", FOOTER_TEXT);
  expect(Math.abs(after - before)).toBeLessThanOrEqual(FOOTER_STABLE_TOLERANCE_MM);
});

test("layout editor: header text lies in the top margin, a click in the footer activates it", async ({
  page,
}) => {
  await loginAs(page, PRINT_EDITOR_TENANTS.appearance.adminEmail, PRINT_EDITOR_PASSWORD);
  await page.goto(LAYOUT_URL);
  await expect(page.getByTestId("document-designer-layout-editor")).toBeVisible();

  const paperBox = await page.getByTestId("document-designer-paper").boundingBox();
  const regionBox = await page.getByTestId("document-designer-region-header").boundingBox();
  expect(paperBox).not.toBeNull();
  expect(regionBox).not.toBeNull();
  const { y: paperY, width: paperWidth } = paperBox as NonNullable<typeof paperBox>;
  const regionTopMm =
    (((regionBox as NonNullable<typeof regionBox>).y - paperY) * 210) / paperWidth;
  expect(regionTopMm).toBeLessThan(HEADER_REGION_MAX_TOP_MM);

  const footer = page.getByTestId("document-designer-region-footer");
  const header = page.getByTestId("document-designer-region-header");
  await footer.locator('[contenteditable="true"]').first().click();
  await expect(footer).toHaveAttribute("data-active", "true");
  await expect(header).toHaveAttribute("data-active", "false");
});

test("ruler: one tick per centimetre and fine ticks in between", async ({ page }) => {
  await openTemplateEditor(page);
  const ruler = page.getByTestId("page-ruler-top");
  await expect(ruler.locator("[data-ruler-cm]")).toHaveCount(20);
  const fineTicks = await ruler.locator("[data-ruler-half]").count();
  expect(fineTicks).toBeGreaterThanOrEqual(20);
});

const STATEMENT_URL = "/pdf-template-editor?slug=rental%3Autility-statement&locale=de";
const RECIPIENT_NAME = "Erika Musterfrau";
const STREET_LINE = "Lindenweg 4";
const SECOND_CELL_LINE = "nach Wohnfläche verteilt";
// The preview fills a money variable without example with 0.
const SAMPLE_AMOUNT = "0,00 €";
const A4_WIDTH_MM = 210;
const LAYOUT_TOLERANCE_MM = 1.5;
const TEXT_EDGE_TOLERANCE_MM = 1;
const LINE_GRID_TOLERANCE_MM = 0.5;
// Base font 10.5 pt times the 1.2 line height; the layout of this template does not change the size.
const BODY_LINE_MM = (10.5 * 1.2 * 25.4) / 72;
const TABLE_EDGE_TOLERANCE_MM = 0.5;

type TextPositionMm = { readonly topMm: number; readonly leftMm: number };

// Editor lines are measured from the text range like in editorTextTopMm; the PDF preview positions every
// span in percent of the page, so both give millimetres from the paper's top left corner.
async function editorTextPositionMm(page: Page, text: string): Promise<TextPositionMm> {
  const paper = page.getByTestId("document-designer-page");
  await expect(paper).toContainText(text);
  const position = await paper.evaluate(
    (paperElement, args) => {
      const box = paperElement.getBoundingClientRect();
      const mmPerPixel = args.widthMm / box.width;
      const walker = document.createTreeWalker(paperElement, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
        const at = (node.textContent ?? "").indexOf(args.needle);
        if (at < 0) continue;
        const range = document.createRange();
        range.setStart(node, at);
        range.setEnd(node, at + args.needle.length);
        const rect = range.getClientRects()[0];
        if (rect === undefined) continue;
        return {
          topMm: (rect.top - box.top) * mmPerPixel,
          leftMm: (rect.left - box.left) * mmPerPixel,
        };
      }
      return null;
    },
    { needle: text, widthMm: A4_WIDTH_MM },
  );
  expect(position).not.toBeNull();
  return position as TextPositionMm;
}

async function boxOf(locator: Locator) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  return box as NonNullable<typeof box>;
}

async function pdfTextPositionMm(page: Page, text: string): Promise<TextPositionMm> {
  const spans = page.getByTestId("pdf-page-1").locator("span").filter({ hasText: text });
  await expect(spans.first()).toBeVisible({ timeout: E2E_TIMEOUT_MS.poll });
  const positions = await spans.evaluateAll((elements) =>
    elements.map((element) => {
      const style = (element as HTMLElement).style;
      return { top: parseFloat(style.top), left: parseFloat(style.left) };
    }),
  );
  const first = positions.reduce((best, next) => (next.top < best.top ? next : best));
  return {
    topMm: (first.top / 100) * A4_HEIGHT_MM,
    leftMm: (first.left / 100) * A4_WIDTH_MM,
  };
}

test("template editor: address field, heading and first paragraph line up with the PDF", async ({
  page,
}) => {
  await loginAs(page, PRINT_EDITOR_TENANTS.editor.adminEmail, PRINT_EDITOR_PASSWORD);
  await page.goto(STATEMENT_URL);
  const body = page
    .getByTestId("pdf-template-editor")
    .locator('#document-designer-content[contenteditable="true"]');
  await expect(body).toBeVisible();
  const rowCells = page.getByTestId("document-designer-page").locator("tr[data-each] > td");
  await rowCells.first().locator("p").first().click();
  // The editor takes over the clicked caret only on the next selectionchange; an Enter sent
  // before that splits the old selection at the document start.
  await expect(page.getByTestId("document-table-borders")).toBeVisible();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type(SECOND_CELL_LINE);
  await expect(rowCells.first()).toContainText(SECOND_CELL_LINE);
  await body.click();
  await page.getByTestId("document-block-menu").click();
  await page.getByTestId("document-block-address").click();
  const frame = page.getByTestId("document-frame");
  await frame.locator("p").last().click();
  await page.keyboard.type(RECIPIENT_NAME);
  await page.keyboard.press("Enter");
  await page.keyboard.type(STREET_LINE);

  const editor = {
    sender: await editorTextPositionMm(page, "Firmenname"),
    recipient: await editorTextPositionMm(page, RECIPIENT_NAME),
    street: await editorTextPositionMm(page, STREET_LINE),
    heading: await editorTextPositionMm(page, "Nebenkostenabrechnung"),
    paragraph: await editorTextPositionMm(page, "nachfolgend erhalten"),
    tableHead: await editorTextPositionMm(page, "Leistung"),
    header: await editorTextPositionMm(page, "Am Hafen 12"),
  };

  // Sender line and table cells hold variable chips with their own padding, so the editor is measured at the
  // paragraph edge, where the rule under the line starts.
  const paperBox = await boxOf(page.getByTestId("document-designer-page"));
  const senderBox = await boxOf(frame.locator("p").first());
  const senderEdgeMm = ((senderBox.x - paperBox.x) * A4_WIDTH_MM) / paperBox.width;
  const rowCellBox = await boxOf(
    page.getByTestId("document-designer-page").locator("td > p").first(),
  );
  const rowEdgeMm = ((rowCellBox.x - paperBox.x) * A4_WIDTH_MM) / paperBox.width;
  const descriptionCellTop = (await boxOf(rowCells.nth(0).locator("p").first())).y;
  const amountCellTop = (await boxOf(rowCells.nth(1).locator("p").first())).y;
  const editorCellOffsetMm =
    (Math.abs(amountCellTop - descriptionCellTop) * A4_WIDTH_MM) / paperBox.width;

  const stripBox = await boxOf(page.getByTestId("document-repeat-strip").first());
  const tableBox = await boxOf(
    page
      .getByTestId("document-designer-page")
      .locator("table", { has: page.getByTestId("document-repeat-strip") }),
  );
  const textBeforeTable = await boxOf(
    page.getByTestId("document-designer-page").locator("p", { hasText: "nachfolgend erhalten" }),
  );

  await showPreview(page);
  const pdf = {
    sender: await pdfTextPositionMm(page, "Hafenkontor Verwaltung GmbH ·"),
    recipient: await pdfTextPositionMm(page, RECIPIENT_NAME),
    street: await pdfTextPositionMm(page, STREET_LINE),
    heading: await pdfTextPositionMm(page, "Nebenkostenabrechnung"),
    paragraph: await pdfTextPositionMm(page, "nachfolgend erhalten"),
    tableHead: await pdfTextPositionMm(page, "Leistung"),
    tableRow: await pdfTextPositionMm(page, "[description]"),
    header: await pdfTextPositionMm(page, "Am Hafen 12"),
  };

  // A two-line cell must not push its neighbour down: cells are top-aligned in editor and PDF.
  const pdfAmount = await pdfTextPositionMm(page, SAMPLE_AMOUNT);
  await expect(page.getByTestId("pdf-page-1")).toContainText(SECOND_CELL_LINE);
  expect(editorCellOffsetMm, "editor cells are top-aligned").toBeLessThanOrEqual(
    LINE_GRID_TOLERANCE_MM,
  );
  expect(
    Math.abs(pdfAmount.topMm - pdf.tableRow.topMm),
    "pdf cells are top-aligned",
  ).toBeLessThanOrEqual(LINE_GRID_TOLERANCE_MM);

  expect(stripBox.y + stripBox.height, "strip ends above the table").toBeLessThanOrEqual(
    tableBox.y + 0.5,
  );
  expect(stripBox.y, "strip stays below the text before the table").toBeGreaterThanOrEqual(
    textBeforeTable.y + textBeforeTable.height - 0.5,
  );
  expect(
    Math.abs(pdf.street.topMm - pdf.recipient.topMm - BODY_LINE_MM),
    "address lines are one line apart",
  ).toBeLessThanOrEqual(LINE_GRID_TOLERANCE_MM);

  const firstLine = await pdfTextPositionMm(page, "Abrechnungsdatum");
  const secondLine = await pdfTextPositionMm(page, "Guten Tag");
  expect(
    Math.abs(secondLine.topMm - firstLine.topMm - 2 * BODY_LINE_MM),
    "paragraphs are one blank line apart",
  ).toBeLessThanOrEqual(LINE_GRID_TOLERANCE_MM);

  for (const line of ["sender", "recipient", "street", "heading", "paragraph"] as const) {
    expect(Math.abs(editor[line].topMm - pdf[line].topMm), `${line} top`).toBeLessThanOrEqual(
      LAYOUT_TOLERANCE_MM,
    );
  }
  expect(Math.abs(editor.header.leftMm - pdf.header.leftMm), "header left").toBeLessThanOrEqual(
    LAYOUT_TOLERANCE_MM,
  );

  expect(
    Math.abs(senderEdgeMm - editor.paragraph.leftMm),
    "editor sender line starts at the text margin",
  ).toBeLessThanOrEqual(TEXT_EDGE_TOLERANCE_MM);
  expect(
    Math.abs(editor.recipient.leftMm - editor.paragraph.leftMm),
    "editor recipient starts at the text margin",
  ).toBeLessThanOrEqual(TEXT_EDGE_TOLERANCE_MM);
  for (const line of ["tableHead", "tableRow"] as const) {
    const editorLeftMm = line === "tableHead" ? editor.tableHead.leftMm : rowEdgeMm;
    expect(
      Math.abs(editorLeftMm - editor.paragraph.leftMm),
      `editor ${line} starts at the text margin`,
    ).toBeLessThanOrEqual(TABLE_EDGE_TOLERANCE_MM);
    expect(
      Math.abs(pdf[line].leftMm - pdf.paragraph.leftMm),
      `pdf ${line} starts at the text margin`,
    ).toBeLessThanOrEqual(TABLE_EDGE_TOLERANCE_MM);
  }
  const pdfPage = page.getByTestId("pdf-page-1");
  await expect(pdfPage).toContainText("Hamburg");
  await expect(pdfPage).not.toContainText("…");

  for (const line of ["sender", "recipient"] as const) {
    expect(
      Math.abs(pdf[line].leftMm - pdf.paragraph.leftMm),
      `pdf ${line} starts at the text margin`,
    ).toBeLessThanOrEqual(TEXT_EDGE_TOLERANCE_MM);
  }
});
