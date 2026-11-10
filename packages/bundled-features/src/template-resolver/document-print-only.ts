// Server-only (happy-dom). Features of the shared document model that only a PDF can render:
// a mail body would keep them through the rebuild, so every other kind refuses them on write.
import type { Element as ScanElement } from "happy-dom";

export const IMAGES_BLOCK_SELECTOR = "div[data-images]";

export const PRINT_STYLE_SELECTORS = [
  "div[data-frame]",
  "span[data-text-style]",
  "[data-line-height]",
  "[data-space-before]",
  "[data-space-after]",
  "table[data-borders]",
  "[data-background]",
  "[data-colwidth]",
  "img[data-bleed]",
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

export function hasFrame(body: ScanElement): boolean {
  return body.querySelector("div[data-frame]") !== null;
}
