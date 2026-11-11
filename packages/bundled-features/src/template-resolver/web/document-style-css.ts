// Pure CSS-string builders over already validated values. Shared by the server compile and the
// editor decorations, so the PDF and the editor measure the same way. The custom properties
// (--paper-pt, --paper-mm, ...) default to real units for print; the editor overrides them to scale.
import { DOCUMENT_FONT_PRINT_STACKS, type DocumentFont } from "./document-fonts.ts";

export type DocumentTextStyle = {
  readonly color?: string | null;
  readonly font?: DocumentFont | null;
  readonly sizePt?: number | null;
};

export type DocumentBlockStyle = {
  readonly lineHeight?: number | null;
  readonly spaceBeforePt?: number | null;
  readonly spaceAfterPt?: number | null;
};

export type DocumentFrameBox = {
  readonly xMm: number;
  readonly yMm: number;
  readonly widthMm: number;
  readonly heightMm: number;
};

function pt(value: number): string {
  return `calc(${value} * var(--paper-pt,1pt))`;
}

function mm(value: number): string {
  return `calc(${value} * var(--paper-mm,1mm))`;
}

function declarations(parts: ReadonlyArray<string | null>): string {
  return parts.filter((part): part is string => part !== null).join(";");
}

export function documentTextStyleCss(style: DocumentTextStyle): string {
  return declarations([
    style.color == null ? null : `color:${style.color}`,
    style.font == null ? null : `font-family:${DOCUMENT_FONT_PRINT_STACKS[style.font]}`,
    style.sizePt == null ? null : `font-size:${pt(style.sizePt)}`,
  ]);
}

export function documentBlockStyleCss(style: DocumentBlockStyle): string {
  return declarations([
    style.lineHeight == null ? null : `line-height:${style.lineHeight}`,
    style.spaceBeforePt == null ? null : `margin-top:${pt(style.spaceBeforePt)}`,
    style.spaceAfterPt == null ? null : `margin-bottom:${pt(style.spaceAfterPt)}`,
  ]);
}

// Chromium clips body content at the margin box, so a frame that sits in the margin is moved
// to the content edge; the first-page margin override in the print CSS makes that edge reach the frame.
export function documentFrameCss(frame: DocumentFrameBox): string {
  return declarations([
    "position:absolute",
    "overflow:hidden",
    `--frame-x:${mm(frame.xMm)}`,
    `left:max(0px,calc(${frame.xMm} * var(--paper-mm,1mm) - var(--page-margin-left,0px)))`,
    `top:max(0px,calc(${frame.yMm} * var(--paper-mm,1mm) - var(--first-page-top,0px)))`,
    `width:${mm(frame.widthMm)}`,
    `height:${mm(frame.heightMm)}`,
  ]);
}

export type DocumentImageStyle = {
  readonly widthMm?: number | null;
  readonly align?: "left" | "center" | "right" | null;
};

const IMAGE_ALIGN_MARGINS = {
  left: "margin-left:0;margin-right:auto",
  center: "margin-left:auto;margin-right:auto",
  right: "margin-left:auto;margin-right:0",
} as const;

// An explicit width replaces the region's height cap, so a layout logo can be as large as the author set it.
export function documentImageCss(style: DocumentImageStyle): string {
  return declarations([
    style.widthMm == null
      ? null
      : `width:${mm(style.widthMm)};max-width:100%;height:auto;max-height:none`,
    style.align == null ? null : `display:block;${IMAGE_ALIGN_MARGINS[style.align]}`,
  ]);
}

const DIVIDER_DEFAULT_COLOR = "#bbb";
const DIVIDER_DEFAULT_WEIGHT_PT = 0.75;

export function documentDividerCss(style: {
  readonly color?: string | null;
  readonly weightPt?: number | null;
}): string {
  if (style.color == null && style.weightPt == null) return "";
  return declarations([
    "border:0",
    `border-top:${pt(style.weightPt ?? DIVIDER_DEFAULT_WEIGHT_PT)} solid ${style.color ?? DIVIDER_DEFAULT_COLOR}`,
  ]);
}

export type DocumentRowLine = { readonly color: string; readonly weightPt: number };

export type DocumentRowEdges = {
  readonly top: DocumentRowLine | null;
  readonly bottom: DocumentRowLine | null;
};

// The rule between two rows is one edge: a row's own line wins, otherwise it mirrors its
// neighbour's, so a thin dark rule is not outvoted by the table style's rule on the other cell.
// A repeat row expands into any number of rows at render time, so a neighbour's line cannot be
// mirrored onto it (it would hit every copy) and its own lines are never mirrored outward.
export function resolveRowEdges(
  rows: ReadonlyArray<{
    readonly lineAbove: DocumentRowLine | null;
    readonly lineBelow: DocumentRowLine | null;
    readonly repeats?: boolean;
  }>,
): DocumentRowEdges[] {
  const mirrorable = (index: number): boolean => rows[index]?.repeats !== true;
  return rows.map((row, index) => {
    const own = mirrorable(index);
    return {
      top:
        row.lineAbove ??
        (own && mirrorable(index - 1) ? (rows[index - 1]?.lineBelow ?? null) : null),
      bottom:
        row.lineBelow ??
        (own && mirrorable(index + 1) ? (rows[index + 1]?.lineAbove ?? null) : null),
    };
  });
}

export type DocumentCellStyle = {
  readonly background?: string | null;
  readonly paddingMm?: number | null;
  readonly isFirstInRow?: boolean;
  readonly isLastInRow?: boolean;
  readonly edges?: DocumentRowEdges | undefined;
};

// 6px, the inset the layout's header background restores: a filled cell must not run flush against its text.
export const FILLED_CELL_EDGE_INSET_MM = 1.5875;

function ruleCss(side: "top" | "bottom", line: DocumentRowLine | null | undefined): string | null {
  return line == null ? null : `border-${side}:${pt(line.weightPt)} solid ${line.color}`;
}

// The outer columns of a table print flush with the text margin; a filled outer cell keeps an inset so its text stays inside the fill.
export function documentCellStyleCss(style: DocumentCellStyle): string {
  const hasBackground = style.background != null;
  const padding = style.paddingMm ?? null;
  const outerMm = hasBackground ? (padding ?? FILLED_CELL_EDGE_INSET_MM) : null;
  const left = style.isFirstInRow === true ? outerMm : padding;
  const right = style.isLastInRow === true ? outerMm : padding;
  return declarations([
    hasBackground ? `background-color:${style.background}` : null,
    padding === null ? null : `padding-top:${mm(padding)};padding-bottom:${mm(padding)}`,
    left === null ? null : `padding-left:${mm(left)}`,
    right === null ? null : `padding-right:${mm(right)}`,
    ruleCss("top", style.edges?.top),
    ruleCss("bottom", style.edges?.bottom),
  ]);
}

export type DocumentTableStyle = {
  readonly widthMm?: number | null;
  readonly align?: "left" | "center" | "right" | null;
};

export function documentTableCss(style: DocumentTableStyle): string {
  return declarations([
    style.widthMm == null ? null : `width:${mm(style.widthMm)};max-width:100%`,
    style.align == null ? null : IMAGE_ALIGN_MARGINS[style.align],
  ]);
}

// Gap between the bottom of a flow-reserving frame and the first flowing line, shared by the
// editor's reserved area and the PDF's first-page spacer.
export const FRAME_FLOW_GAP_MM = 8;

// Effective paragraph defaults when nothing is set: the PDF body and the editor paper both use
// them, so a line sits at the same height in both.
export const PARAGRAPH_DEFAULT_LINE_HEIGHT = 1.2;
// One "line" (the body size times the default line height) is the spacing unit of paragraphs,
// headings, tables and lists, so text sits on a line grid with one blank line between blocks.
export function documentLinePt(fontSizePt: number): number {
  return Number((fontSizePt * PARAGRAPH_DEFAULT_LINE_HEIGHT).toFixed(2));
}

export const DOCUMENT_LINE_VARIABLE = "--doc-line";

export const SENDER_LINE_SIZE_PT = 7;
const SENDER_LINE_INSET_MM = 1.7;
const SENDER_LINE_RECIPIENT_GAP_MM = 4;
const SENDER_LINE_RULE_COLOR = "#8a877e";

// Every paragraph of an address frame starts at the page's text margin, or inset when the frame
// sits right of it; the sender line also carries the rule and the gap to the recipient. Only
// emitted for a real sender line, so an address frame without one starts with the recipient.
export function addressParagraphCss(isSenderLine: boolean): string {
  return declarations([
    `margin-left:max(${mm(SENDER_LINE_INSET_MM)},calc(var(--paper-margin-left,0px) - var(--frame-x,0px)))`,
    `padding-right:${mm(SENDER_LINE_INSET_MM)}`,
    "margin-bottom:0",
    ...(isSenderLine
      ? [
          `border-bottom:1px solid ${SENDER_LINE_RULE_COLOR}`,
          `margin-bottom:${mm(SENDER_LINE_RECIPIENT_GAP_MM)}`,
          `padding-bottom:${mm(0.7)}`,
        ]
      : []),
  ]);
}
