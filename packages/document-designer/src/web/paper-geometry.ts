import {
  DOCUMENT_FONT_PRINT_STACKS,
  PDF_DEFAULT_MARGIN_MM,
  PDF_FOOTER_MARGIN_MM,
  PDF_HEADER_MARGIN_MM,
  type PdfTableStyle,
} from "@cosmicdrift/kumiko-bundled-features/template-resolver/web";
import {
  DEFAULT_PDF_FONT_SIZE_PT,
  isHexColor,
  PDF_LAYOUT_FONT_SIZE_RANGE,
  type PdfLayoutLook,
} from "./layout-meta.ts";
import { MARGIN_SIDES, type MarginSide, type Orientation, type PageFormat } from "./pdf-meta.ts";
import type { LayoutRegionsHtml } from "./types.ts";

export type PaperSize = { readonly widthMm: number; readonly heightMm: number };
export type MarginsMm = Readonly<Record<MarginSide, number>>;
export type PartialMarginsMm = Readonly<Partial<Record<MarginSide, number>>>;
export type MarginInput = Readonly<Record<MarginSide, number | "">>;

const MM_PER_INCH = 25.4;
const PT_PER_INCH = 72;
const MM_PER_CM = 10;

const PORTRAIT_SIZES_MM: Readonly<Record<PageFormat, PaperSize>> = {
  A4: { widthMm: 210, heightMm: 297 },
  Letter: { widthMm: 215.9, heightMm: 279.4 },
};

export function paperSizeMm(format: PageFormat, orientation: Orientation): PaperSize {
  const portrait = PORTRAIT_SIZES_MM[format];
  return orientation === "portrait"
    ? portrait
    : { widthMm: portrait.heightMm, heightMm: portrait.widthMm };
}

export function paperWidthPt(size: PaperSize): number {
  return Number(((size.widthMm * PT_PER_INCH) / MM_PER_INCH).toFixed(2));
}

export const EMPTY_MARGIN_INPUT: MarginInput = { top: "", right: "", bottom: "", left: "" };

// Mirrors the renderer: the template's own value wins over the layout's, which wins over the default.
export function resolveMarginsMm(input: {
  readonly template: MarginInput;
  readonly layout: PartialMarginsMm;
  readonly hasHeader: boolean;
  readonly hasFooter: boolean;
}): MarginsMm {
  const { template, layout } = input;
  const pick = (side: MarginSide, fallback: number): number => {
    const own = template[side];
    return own === "" ? (layout[side] ?? fallback) : own;
  };
  return {
    top: pick("top", input.hasHeader ? PDF_HEADER_MARGIN_MM : PDF_DEFAULT_MARGIN_MM),
    right: pick("right", PDF_DEFAULT_MARGIN_MM),
    bottom: pick("bottom", input.hasFooter ? PDF_FOOTER_MARGIN_MM : PDF_DEFAULT_MARGIN_MM),
    left: pick("left", PDF_DEFAULT_MARGIN_MM),
  };
}

export function layoutRegionFlags(
  layoutHeaderFooter: boolean,
  regions: LayoutRegionsHtml | null,
): { readonly showRegions: boolean; readonly hasHeader: boolean; readonly hasFooter: boolean } {
  const showRegions = layoutHeaderFooter && regions !== null;
  return {
    showRegions,
    hasHeader: showRegions && regions.header.trim() !== "",
    hasFooter: showRegions && regions.footer.trim() !== "",
  };
}

export function percentOfExtent(mm: number, extentMm: number): number {
  return Number(((mm / extentMm) * 100).toFixed(3));
}

export type RulerMark = { readonly cm: number; readonly percent: number };

export function rulerMarks(extentMm: number): readonly RulerMark[] {
  // A mark on the paper edge would be cut off by the ruler, so the last full centimetre stays inside.
  const count = Math.ceil(extentMm / MM_PER_CM) - 1;
  return Array.from({ length: count }, (_, index) => {
    const cm = index + 1;
    return { cm, percent: percentOfExtent(cm * MM_PER_CM, extentMm) };
  });
}

const MM_PER_HALF_CM = 5;

export type RulerHalfMark = { readonly mm: number; readonly percent: number };

// The 5 mm ticks between the centimetre ticks: 5, 15, 25 ... while they still fit on the paper.
export function rulerHalfMarks(extentMm: number): readonly RulerHalfMark[] {
  const count = Math.floor((extentMm - MM_PER_HALF_CM) / MM_PER_CM) + 1;
  return Array.from({ length: Math.max(count, 0) }, (_, index) => {
    const mm = MM_PER_HALF_CM + index * MM_PER_CM;
    return { mm, percent: percentOfExtent(mm, extentMm) };
  });
}

export type PaperLook = {
  readonly tableStyle: PdfTableStyle;
  readonly fontStack: string | null;
  readonly fontSizePt: number;
  readonly textColor: string | null;
  readonly tableHeaderBackground: string | null;
};

// 100cqw only resolves for descendants of the sized container, so these are set on a child that fills the paper.
export function paperVariables(input: {
  readonly size: PaperSize;
  readonly margins: MarginsMm;
  readonly look: PaperLook;
}): Readonly<Record<string, string>> {
  const { size, margins, look } = input;
  const variables: Record<string, string> = {
    "--paper-mm": `calc(100cqw / ${size.widthMm})`,
    "--paper-pt": `calc(100cqw / ${paperWidthPt(size)})`,
    "--paper-height": `calc(${size.heightMm} * var(--paper-mm))`,
    "--paper-font-size": `calc(${look.fontSizePt} * var(--paper-pt))`,
    "--page-margin-left": "0px",
    "--first-page-top": "0px",
    "--page-margin-top-mm": String(margins.top),
  };
  for (const side of MARGIN_SIDES) {
    variables[`--paper-margin-${side}`] = `calc(${margins[side]} * var(--paper-mm))`;
  }
  if (look.fontStack !== null) variables["--paper-font-family"] = look.fontStack;
  if (look.textColor !== null) variables["--paper-text-color"] = look.textColor;
  if (look.tableHeaderBackground !== null) {
    variables["--paper-table-header"] = look.tableHeaderBackground;
  }
  return variables;
}

export function applyCssVariables(
  element: HTMLElement | null,
  variables: Readonly<Record<string, string>>,
): void {
  if (element === null) return;
  for (const [name, value] of Object.entries(variables)) element.style.setProperty(name, value);
}

// A half-typed value must not blow up the paper, so anything invalid falls back to the default.
export function paperLookOf(look: PdfLayoutLook): PaperLook {
  const size = look.fontSizePt;
  const sizeUsable =
    size !== "" && size >= PDF_LAYOUT_FONT_SIZE_RANGE.min && size <= PDF_LAYOUT_FONT_SIZE_RANGE.max;
  return {
    tableStyle: look.tableStyle,
    fontStack: DOCUMENT_FONT_PRINT_STACKS[look.fontFamily],
    fontSizePt: sizeUsable ? size : DEFAULT_PDF_FONT_SIZE_PT,
    textColor: isHexColor(look.textColor) ? look.textColor : null,
    tableHeaderBackground: isHexColor(look.tableHeaderBackground)
      ? look.tableHeaderBackground
      : null,
  };
}
