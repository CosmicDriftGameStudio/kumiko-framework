// Prints a built document request. Chromium alone covers one render; the two things it cannot do
// (a header or footer that skips page 1, DIN fold marks and corner marks at the paper edge) are finished on the
// PDF it returns.

import { RendererError } from "@cosmicdrift/kumiko-bundled-features/renderer-foundation";
import {
  PDF_CORNER_MARK_INSET_MM,
  PDF_CORNER_MARK_LEG_MM,
  type PdfFoldMarks,
} from "@cosmicdrift/kumiko-bundled-features/template-resolver";
import { grayscale, PDFArray, PDFDocument, type PDFPage } from "pdf-lib";
import type { ClientConfig } from "./config.ts";
import type { DocumentPdfRequest } from "./document-pdf.ts";
import { postRender } from "./http-client.ts";

const POINTS_PER_MM = 72 / 25.4;
const FOLD_MARK_LENGTH_MM = 5;
const PUNCH_MARK_LENGTH_MM = 8;
const FOLD_MARK_THICKNESS_PT = 0.5;
const FOLD_MARK_GRAY = 0.35;

type FoldMarkPositions = {
  readonly foldsMm: readonly number[];
  readonly punchMm: number;
};

// DIN 5008 measured from the top edge: form A folds at 87 and 192 mm, form B at 105 and 210 mm.
const FOLD_MARK_POSITIONS: Readonly<Record<Exclude<PdfFoldMarks, "none">, FoldMarkPositions>> = {
  "din-a": { foldsMm: [87, 192], punchMm: 148.5 },
  "din-b": { foldsMm: [105, 210], punchMm: 148.5 },
};

function drawMark(page: PDFPage, distanceFromTopMm: number, lengthMm: number): void {
  const y = page.getHeight() - distanceFromTopMm * POINTS_PER_MM;
  page.drawLine({
    start: { x: 0, y },
    end: { x: lengthMm * POINTS_PER_MM, y },
    thickness: FOLD_MARK_THICKNESS_PT,
    color: grayscale(FOLD_MARK_GRAY),
  });
}

function drawFoldMarks(doc: PDFDocument, foldMarks: Exclude<PdfFoldMarks, "none">): void {
  const { foldsMm, punchMm } = FOLD_MARK_POSITIONS[foldMarks];
  for (const page of doc.getPages()) {
    for (const foldMm of foldsMm) drawMark(page, foldMm, FOLD_MARK_LENGTH_MM);
    drawMark(page, punchMm, PUNCH_MARK_LENGTH_MM);
  }
}

function drawCornerMarks(doc: PDFDocument): void {
  const inset = PDF_CORNER_MARK_INSET_MM * POINTS_PER_MM;
  const leg = PDF_CORNER_MARK_LEG_MM * POINTS_PER_MM;
  const line = { thickness: FOLD_MARK_THICKNESS_PT, color: grayscale(FOLD_MARK_GRAY) };
  for (const page of doc.getPages()) {
    for (const x of [inset, page.getWidth() - inset]) {
      for (const y of [inset, page.getHeight() - inset]) {
        const towardCentreX = x < page.getWidth() / 2 ? leg : -leg;
        const towardCentreY = y < page.getHeight() / 2 ? leg : -leg;
        page.drawLine({ start: { x, y }, end: { x: x + towardCentreX, y }, ...line });
        page.drawLine({ start: { x, y }, end: { x, y: y + towardCentreY }, ...line });
      }
    }
  }
}

const HEX_CHANNEL_MAX = 255;

// Chromium content streams stay untouched: the fill goes in as the first stream of each page, so everything printed (and every mark drawn later) lies on top.
function fillPaperBehindContent(doc: PDFDocument, paperColor: string): void {
  const [red = 0, green = 0, blue = 0] = [1, 3, 5].map(
    (start) => Number.parseInt(paperColor.slice(start, start + 2), 16) / HEX_CHANNEL_MAX,
  );
  for (const page of doc.getPages()) {
    const fill = doc.context.register(
      doc.context.stream(
        `q ${red} ${green} ${blue} rg 0 0 ${page.getWidth()} ${page.getHeight()} re f Q`,
      ),
    );
    page.node.normalize();
    const contents = page.node.Contents();
    if (contents instanceof PDFArray) contents.insert(0, fill);
  }
}

async function swapInFirstPage(
  doc: PDFDocument,
  firstPagePdf: Uint8Array,
  pageCount: number,
): Promise<void> {
  const firstPageDoc = await PDFDocument.load(firstPagePdf, { updateMetadata: false });
  if (firstPageDoc.getPageCount() !== pageCount) {
    throw new RendererError(
      `renderer-puppeteer-client: the first-page print has ${firstPageDoc.getPageCount()} pages, the document ${pageCount}`,
      "other",
    );
  }
  const [firstPage] = await doc.copyPages(firstPageDoc, [0]);
  if (firstPage === undefined) return;
  doc.removePage(0);
  doc.insertPage(0, firstPage);
}

export async function printDocumentPdf(
  config: ClientConfig,
  built: DocumentPdfRequest,
): Promise<Uint8Array> {
  const printed = await postRender(config, {
    kind: "document-pdf",
    html: built.html,
    options: built.options,
  });
  const needsFinishing =
    built.firstPageOptions !== null ||
    built.foldMarks !== "none" ||
    built.cornerMarks ||
    built.paperColor !== null;
  if (!needsFinishing) return printed.bytes;

  const doc = await PDFDocument.load(printed.bytes, { updateMetadata: false });
  if (built.firstPageOptions !== null) {
    const firstPrint = await postRender(config, {
      kind: "document-pdf",
      html: built.html,
      options: built.firstPageOptions,
    });
    await swapInFirstPage(doc, firstPrint.bytes, doc.getPageCount());
  }
  if (built.paperColor !== null) fillPaperBehindContent(doc, built.paperColor);
  if (built.foldMarks !== "none") drawFoldMarks(doc, built.foldMarks);
  if (built.cornerMarks) drawCornerMarks(doc);
  // Plain object table: countPdfPages reads the page tree from the raw bytes and cannot see into object streams.
  return doc.save({ useObjectStreams: false });
}
