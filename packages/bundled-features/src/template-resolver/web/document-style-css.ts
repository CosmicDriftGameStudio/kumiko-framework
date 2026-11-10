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

export function documentCellStyleCss(style: { readonly background?: string | null }): string {
  return style.background == null ? "" : `background-color:${style.background}`;
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
