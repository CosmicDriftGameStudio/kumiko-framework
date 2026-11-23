import { PDFDocument } from "pdf-lib";
import { loadPdfWithinDecodeBudget } from "./pdf-load.ts";

const A4_WIDTH_PT = 595.276;
const A4_HEIGHT_PT = 841.89;
const SIZE_TOLERANCE_PT = 1;

export const POSTAL_PDF_REJECTION_REASONS = [
  "file-too-large",
  "unreadable",
  "rotated-page",
  "landscape-page",
  "not-a4-page",
] as const;

export type PostalPdfRejectionReason = (typeof POSTAL_PDF_REJECTION_REASONS)[number];

export type PostalPdfCheck =
  | { readonly ok: true; readonly pageCount: number }
  | {
      readonly ok: false;
      readonly reason: PostalPdfRejectionReason;
      // 1-based; null when the reason concerns the whole file.
      readonly page: number | null;
      readonly detail: string;
    };

function reject(
  reason: PostalPdfRejectionReason,
  page: number | null,
  detail: string,
): PostalPdfCheck {
  return { ok: false, reason, page, detail };
}

function isNear(actual: number, expected: number): boolean {
  return Math.abs(actual - expected) <= SIZE_TOLERANCE_PT;
}

// The original pages are copied as they are; the appended pages only get added.
export async function appendPdfPages(
  original: Uint8Array,
  appendix: Uint8Array,
): Promise<Uint8Array> {
  const merged = await loadPdfWithinDecodeBudget(original);
  const extra = await loadPdfWithinDecodeBudget(appendix);
  const pages = await merged.copyPages(extra, extra.getPageIndices());
  for (const page of pages) merged.addPage(page);
  return merged.save();
}

export class PdfPageLimitError extends Error {
  constructor(
    readonly pageCount: number,
    readonly maxPages: number,
  ) {
    super(`${pageCount} pages exceed the limit of ${maxPages}`);
  }
}

// Plain object table: countPdfPages reads the page tree from the raw bytes and cannot see into object streams.
// With `startEachFileOnNewSheet` a file with an odd page count is followed by a blank page (size of its last page),
// so the next file starts on a fresh duplex sheet; the blank pages count towards `maxPages`.
export async function mergePdfs(
  buffers: readonly Uint8Array[],
  options: { readonly maxPages?: number; readonly startEachFileOnNewSheet?: boolean } = {},
): Promise<Uint8Array> {
  const merged = await PDFDocument.create();
  let totalPages = 0;
  for (const [index, buffer] of buffers.entries()) {
    const source = await loadPdfWithinDecodeBudget(buffer);
    const sourcePages = source.getPageCount();
    const needsFiller =
      options.startEachFileOnNewSheet === true &&
      index < buffers.length - 1 &&
      sourcePages % 2 === 1;
    totalPages += sourcePages + (needsFiller ? 1 : 0);
    if (options.maxPages !== undefined && totalPages > options.maxPages) {
      throw new PdfPageLimitError(totalPages, options.maxPages);
    }
    const pages = await merged.copyPages(source, source.getPageIndices());
    for (const page of pages) merged.addPage(page);
    if (needsFiller) {
      const last = pages[pages.length - 1];
      if (last !== undefined) merged.addPage([last.getWidth(), last.getHeight()]);
    }
  }
  return merged.save({ useObjectStreams: false });
}

export async function checkPostalPdf(
  bytes: Uint8Array,
  options: { readonly maxBytes: number },
): Promise<PostalPdfCheck> {
  if (bytes.byteLength > options.maxBytes) {
    return reject(
      "file-too-large",
      null,
      `${bytes.byteLength} bytes exceed the limit of ${options.maxBytes}`,
    );
  }
  let doc: PDFDocument;
  try {
    doc = await loadPdfWithinDecodeBudget(bytes, { updateMetadata: false });
  } catch {
    return reject("unreadable", null, "the file is not a readable, unencrypted PDF");
  }
  for (const [index, page] of doc.getPages().entries()) {
    const pageNumber = index + 1;
    const rotation = page.getRotation().angle;
    if (rotation % 360 !== 0) {
      return reject("rotated-page", pageNumber, `page ${pageNumber} is rotated by ${rotation}`);
    }
    const { width, height } = page.getSize();
    if (width > height + SIZE_TOLERANCE_PT) {
      return reject("landscape-page", pageNumber, `page ${pageNumber} is landscape`);
    }
    if (!isNear(width, A4_WIDTH_PT) || !isNear(height, A4_HEIGHT_PT)) {
      return reject(
        "not-a4-page",
        pageNumber,
        `page ${pageNumber} is ${width.toFixed(1)} x ${height.toFixed(1)} pt, expected A4 portrait`,
      );
    }
  }
  return { ok: true, pageCount: doc.getPageCount() };
}
