// Server-only (happy-dom). Features of the shared document model that only a PDF can render:
// a mail body would keep them through the rebuild, so every other kind refuses them on write.
import type { Element as ScanElement } from "happy-dom";
import { readFrameAttributes } from "./web/document-print-style.ts";
import { PDF_MAX_PAGE_EDGE_MM } from "./web/pdf-constants.ts";

export const IMAGES_BLOCK_SELECTOR = "div[data-images]";

export const PRINT_STYLE_SELECTORS = [
  "div[data-frame]",
  "span[data-text-style]",
  "[data-line-height]",
  "[data-space-before]",
  "[data-space-after]",
  "table[data-borders]",
  "table[data-cell-padding-mm]",
  "table[data-table-width-mm]",
  "table[data-table-align]",
  "tr[data-line-above]",
  "tr[data-line-below]",
  "[data-background]",
  "[data-colwidth]",
  "div[data-image-columns]",
  "img[data-bleed]",
  "img[data-width-mm]",
  "img[data-align]",
  "hr[data-color]",
  "hr[data-weight-pt]",
] as const;

export type PrintOnlyFeatures = {
  readonly hasImagesBlock: boolean;
  readonly printStyleSelectors: readonly string[];
};

export function scanPrintOnlyFeatures(body: ScanElement): PrintOnlyFeatures {
  return {
    hasImagesBlock: body.querySelector(IMAGES_BLOCK_SELECTOR) !== null,
    printStyleSelectors: PRINT_STYLE_SELECTORS.filter(
      (selector) => body.querySelector(selector) !== null,
    ),
  };
}

export function hasNestedFrame(body: ScanElement): boolean {
  return Array.from(body.querySelectorAll("div[data-frame]")).some(
    (frame) => frame.parentElement !== body,
  );
}

export function framesOutsidePage(body: ScanElement): string[] {
  return Array.from(body.querySelectorAll("div[data-frame]")).flatMap((element) => {
    const frame = readFrameAttributes(element);
    if (frame === null) return [];
    const overshootsPage =
      frame.xMm + frame.widthMm > PDF_MAX_PAGE_EDGE_MM ||
      frame.yMm + frame.heightMm > PDF_MAX_PAGE_EDGE_MM;
    return overshootsPage
      ? [`${frame.xMm}/${frame.yMm} ${frame.widthMm}x${frame.heightMm} mm`]
      : [];
  });
}

export function hasFrame(body: ScanElement): boolean {
  return body.querySelector("div[data-frame]") !== null;
}
