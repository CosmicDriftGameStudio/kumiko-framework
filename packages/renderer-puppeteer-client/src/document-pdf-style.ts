// CSS and page geometry of a printed document: margins, layout appearance, frame planning and the
// header/footer templates Chromium prints on every page.
import {
  addressParagraphCss,
  DOCUMENT_FONT_PRINT_STACKS,
  DOCUMENT_LINE_VARIABLE,
  type DocumentFrameAttributes,
  documentLinePt,
  FRAME_FLOW_GAP_MM,
  PDF_DEFAULT_FONT_SIZE_PT,
  PDF_DEFAULT_MARGIN_MM,
  PDF_FOOTER_MARGIN_MM,
  PDF_HEADER_MARGIN_MM,
  type PdfLayoutMeta,
  type PdfTemplateMeta,
  SENDER_LINE_SIZE_PT,
} from "@cosmicdrift/kumiko-bundled-features/template-resolver";

// Chromium pads header and footer templates by about this much. The padding is reset so a
// full-bleed image can reach the paper edge, and this wrapper padding keeps text where
// existing letterheads were laid out.
const CHROMIUM_REGION_PADDING_MM = 4;
const TABLE_LINE = "1px solid #bbb";
export const TEXT_ALIGN_CSS_RULES: readonly string[] = [
  "[data-align=left]{text-align:left}",
  "[data-align=center]{text-align:center}",
  "[data-align=right]{text-align:right}",
  "[data-align=justify]{text-align:justify}",
];
const TEXT_ALIGN_CSS = TEXT_ALIGN_CSS_RULES.join("");
const DEFAULT_REGION_FONT = "Helvetica,Arial,sans-serif";

export type PageMarginsMm = {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
};

// Per side: the template's own value wins over the layout's, which wins over the default.
export function resolvePageMargins(
  meta: PdfTemplateMeta | null,
  layoutMeta: PdfLayoutMeta,
  hasHeader: boolean,
  hasFooter: boolean,
): PageMarginsMm {
  const pick = (side: keyof PageMarginsMm, fallback: number): number =>
    meta?.margins?.[side] ?? layoutMeta.margins?.[side] ?? fallback;
  return {
    top: pick("top", hasHeader ? PDF_HEADER_MARGIN_MM : PDF_DEFAULT_MARGIN_MM),
    right: pick("right", PDF_DEFAULT_MARGIN_MM),
    bottom: pick("bottom", hasFooter ? PDF_FOOTER_MARGIN_MM : PDF_DEFAULT_MARGIN_MM),
    left: pick("left", PDF_DEFAULT_MARGIN_MM),
  };
}

const CELL_PADDING_X_PX = 6;

function tableCss(layoutMeta: PdfLayoutMeta): string[] {
  const rules: string[] = [];
  if (layoutMeta.tableStyle === "plain") rules.push("td,th{border:0}");
  if (layoutMeta.tableStyle === "lines") {
    rules.push(`td,th{border:0;border-bottom:${TABLE_LINE}}`);
  }
  if (layoutMeta.tableStyle === "header") {
    rules.push("td,th{border:0}", `th{border-bottom:${TABLE_LINE}}`);
  }
  if (layoutMeta.tableStyle === "grid") {
    rules.push(
      `td,th{border:${TABLE_LINE}}`,
      `tr>:first-child{padding-left:${CELL_PADDING_X_PX}px}`,
      `tr>:last-child{padding-right:${CELL_PADDING_X_PX}px}`,
    );
  }
  if (layoutMeta.tableHeaderBackground !== undefined) {
    rules.push(`th{background-color:${layoutMeta.tableHeaderBackground}}`);
    rules.push(
      `tr>th:first-child{padding-left:${CELL_PADDING_X_PX}px}`,
      `tr>th:last-child{padding-right:${CELL_PADDING_X_PX}px}`,
    );
  }
  // After the table style rules and more specific, so a table marked borderless stays borderless.
  rules.push(".kumiko-table-plain td,.kumiko-table-plain th{border:0}");
  rules.push(
    ".kumiko-table-plain tr>:first-child{padding-left:0}",
    ".kumiko-table-plain tr>:last-child{padding-right:0}",
  );
  return rules;
}

// Empty meta adds nothing, so documents without layout appearance print as before.
export function layoutAppearanceCss(layoutMeta: PdfLayoutMeta): string {
  const bodyDeclarations = [
    layoutMeta.fontFamily === undefined
      ? null
      : `font-family:${DOCUMENT_FONT_PRINT_STACKS[layoutMeta.fontFamily]}`,
    layoutMeta.fontSizePt === undefined ? null : `font-size:${layoutMeta.fontSizePt}pt`,
    layoutMeta.fontSizePt === undefined
      ? null
      : `${DOCUMENT_LINE_VARIABLE}:${documentLinePt(layoutMeta.fontSizePt)}pt`,
    layoutMeta.textColor === undefined ? null : `color:${layoutMeta.textColor}`,
  ].filter((declaration): declaration is string => declaration !== null);
  const hasAppearance =
    bodyDeclarations.length > 0 ||
    layoutMeta.tableStyle !== undefined ||
    layoutMeta.tableHeaderBackground !== undefined;
  if (!hasAppearance) return "";
  return [
    ...(bodyDeclarations.length > 0 ? [`body{${bodyDeclarations.join(";")}}`] : []),
    ...tableCss(layoutMeta),
  ].join("");
}

export type FirstPagePlan = {
  readonly firstTopMm: number;
  readonly pageLeftMm: number;
  readonly css: string;
  /** Spacer that starts flowing text at the top margin or below the reserving frames; null when none is needed. */
  readonly flowHeightMm: number | null;
};

// Chromium clips body content at the margin box, so a frame above the top margin needs the first
// page's margin lowered; later pages keep the regular margin. A frame left of the layout margin
// moves the page margin outwards for the frame, and body padding keeps the flowing text at the
// layout margin on every page.
export function planFirstPage(
  frames: readonly DocumentFrameAttributes[],
  marginTopMm: number,
  marginLeftMm: number,
): FirstPagePlan {
  const firstTopMm = Math.min(marginTopMm, ...frames.map((frame) => frame.yMm));
  const pageLeftMm = Math.min(marginLeftMm, ...frames.map((frame) => frame.xMm));
  const reserving = frames.filter((frame) => frame.reserveFlow);
  const textStartMm = Math.max(
    marginTopMm,
    ...reserving.map((frame) => frame.yMm + frame.heightMm + FRAME_FLOW_GAP_MM),
  );
  const css = [
    `body{--page-margin-left:${pageLeftMm}mm;--first-page-top:${firstTopMm}mm;--paper-margin-left:${marginLeftMm}mm}`,
    ...(pageLeftMm < marginLeftMm ? [`body{padding-left:${marginLeftMm - pageLeftMm}mm}`] : []),
    ...(firstTopMm < marginTopMm ? [`@page:first{margin-top:${firstTopMm}mm}`] : []),
  ].join("");
  return {
    firstTopMm,
    pageLeftMm,
    css,
    flowHeightMm: textStartMm > firstTopMm ? textStartMm - firstTopMm : null,
  };
}

const ADDRESS_FRAME_PARAGRAPHS =
  /(data-frame-preset="address"[^>]*>\s*)(<p(?:\s[^>]*)?>)([\s\S]*?)(<\/p>)/g;
const HTML_TOKEN = /<(\/?)([a-zA-Z][\w-]*)[^>]*?(\/?)>|([^<]+)/g;
const SENDER_SIZE_ATTRIBUTE = `data-size-pt="${SENDER_LINE_SIZE_PT}"`;
const VOID_TAGS: ReadonlySet<string> = new Set(["br", "img", "hr"]);

// The sender line is the first paragraph made only of sender-size text; without the sender checkbox the
// first paragraph is the recipient and must stay as written.
function isSenderLineHtml(inner: string): boolean {
  const insideSender: boolean[] = [];
  let hasText = false;
  for (const token of inner.matchAll(HTML_TOKEN)) {
    const [whole, closing, tag, selfClosing, text] = token;
    if (text !== undefined) {
      if (text.trim() === "") continue;
      hasText = true;
      if (!insideSender.includes(true)) return false;
    } else if (closing === "/") {
      insideSender.pop();
    } else if (tag !== undefined && selfClosing !== "/" && !VOID_TAGS.has(tag.toLowerCase())) {
      insideSender.push(whole.includes(SENDER_SIZE_ATTRIBUTE));
    }
  }
  return hasText;
}

function withStyle(open: string, style: string): string {
  return /\sstyle="/.test(open)
    ? open.replace(/\sstyle="/, ` style="${style};`)
    : // html-ok: style is addressParagraphCss output, built only from numeric constants
      open.replace(/^<p/, `<p style="${style}"`);
}

// The sender line is a single line, so a multi-line company address has to read with the same
// separator the editor uses between name and address. Its rule and spacing come from the same
// CSS builder as the editor decoration.
export function flattenAddressSenderLine(html: string): string {
  return html.replace(
    ADDRESS_FRAME_PARAGRAPHS,
    (match, lead: string, open: string, inner: string, close: string) =>
      isSenderLineHtml(inner)
        ? lead +
          withStyle(open, addressParagraphCss(true)) +
          inner.replace(/\s*\r?\n\s*/g, " · ") +
          close
        : match,
  );
}

export function flowSpacerHtml(plan: FirstPagePlan): string {
  return plan.flowHeightMm === null
    ? ""
    : `<div class="kumiko-frame-flow" style="height:${plan.flowHeightMm}mm"></div>`;
}

export type ChromiumRegionPosition = "header" | "footer";

export function chromiumRegionHtml(args: {
  readonly regionHtml: string;
  readonly position: ChromiumRegionPosition;
  readonly marginLeftMm: number;
  readonly marginRightMm: number;
  readonly layoutMeta: PdfLayoutMeta;
}): string {
  const { regionHtml, position, marginLeftMm, marginRightMm, layoutMeta } = args;
  const edge = position === "header" ? "top:0" : "bottom:0";
  const style =
    "<style>#header,#footer{padding:0!important}html,body{margin:0}table{width:100%;border-collapse:collapse}p{margin:0;white-space:pre-line}img{max-height:20mm}" +
    `img[data-bleed]{position:absolute;${edge};left:0;width:100%;max-height:none}${TEXT_ALIGN_CSS}</style>`;
  const font = `font-family:${
    layoutMeta.fontFamily === undefined
      ? DEFAULT_REGION_FONT
      : DOCUMENT_FONT_PRINT_STACKS[layoutMeta.fontFamily]
  }`;
  const fontSize = `${layoutMeta.fontSizePt ?? PDF_DEFAULT_FONT_SIZE_PT}pt`;
  const color = layoutMeta.textColor ?? "#333";
  const paddingTop = position === "header" ? CHROMIUM_REGION_PADDING_MM : 0;
  const paddingBottom = position === "footer" ? CHROMIUM_REGION_PADDING_MM : 0;
  return (
    style +
    // html-ok: font is an enum-keyed print stack, color a #rrggbb-validated meta value, the rest numbers
    `<div style="width:100%;box-sizing:border-box;${font};font-size:${fontSize};color:${color};padding:${paddingTop}mm ${marginRightMm}mm ${paddingBottom}mm ${marginLeftMm}mm;-webkit-print-color-adjust:exact">${regionHtml}</div>`
  );
}
