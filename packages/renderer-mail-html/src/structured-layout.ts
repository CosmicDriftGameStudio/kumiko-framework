// Renders a structured (html) mail layout: the tenant-editable regions go into
// a fixed in-code MJML frame, so a tenant layout never contributes MJML source.

import {
  compileDocumentBodyToHandlebars,
  isHexColor,
  type MailLayoutAppearance,
  mailLayoutAppearance,
  readLayoutRegions,
} from "@cosmicdrift/kumiko-bundled-features/template-resolver";
import { escapeHtmlAttr } from "@cosmicdrift/kumiko-renderer/headless";
import { headerRowHtml, type ToneColors } from "./mail-chrome.ts";

// The logo of a mail layout and of a mail body is capped here; the editors show the same width.
export const MAIL_IMAGE_MAX_WIDTH_PX = 180;
const MAIL_HEADER_IMAGE_MAX_HEIGHT_PX = 64;
const CARD_BORDER = "#DCDFDA";
const BAND_BACKGROUND = "#FBFBFA";
const BAND_BORDER = "#ECEDEA";

// Appearance values are enum members or a strict hex (see mailLayoutAppearance / isHexColor),
// so interpolating them into the frame cannot inject MJML; the escaping keeps that if the schema widens.
function structuredLayoutFrame(appearance: MailLayoutAppearance, lineColor: string | undefined) {
  const accentLine =
    lineColor !== undefined && isHexColor(lineColor)
      ? `<mj-section background-color="${escapeHtmlAttr(lineColor)}" border-radius="14px 14px 0 0" padding="0">
      <mj-column padding="0">
        <mj-spacer height="4px" padding="0" />
      </mj-column>
    </mj-section>`
      : "";
  return `<mjml lang="{{lang}}">
  <mj-head>
    <mj-title>{{subject}}</mj-title>
    <mj-preview>{{previewText}}</mj-preview>
    <mj-attributes>
      <mj-all font-family="${escapeHtmlAttr(appearance.fontFamily)}" />
      <mj-text font-size="16px" color="#2A2F3A" line-height="1.65" padding="0" />
    </mj-attributes>
  </mj-head>
  <mj-body width="${appearance.width}px" background-color="${escapeHtmlAttr(appearance.outerBackground)}">
    <mj-section padding="0">
      <mj-column>
        <mj-spacer height="48px" padding="0" />
      </mj-column>
    </mj-section>
    <mj-wrapper padding="0" border="1px solid ${CARD_BORDER}" border-radius="14px" background-color="#ffffff">
    ${accentLine}
    {{#if headerRowHtml}}
    <mj-section padding="36px 40px 0 40px">
      <mj-column>
        <mj-text>{{{headerRowHtml}}}</mj-text>
      </mj-column>
    </mj-section>
    {{/if}}
    <mj-section padding="24px 40px 32px 40px">
      <mj-column>
        <mj-text>{{{content}}}</mj-text>
      </mj-column>
    </mj-section>
    {{#if regionSignature}}
    <mj-section padding="0 40px 32px 40px">
      <mj-column>
        <mj-text>{{{regionSignature}}}</mj-text>
      </mj-column>
    </mj-section>
    {{/if}}
    {{#if hasBand}}
    <mj-section background-color="${BAND_BACKGROUND}" border-top="1px solid ${BAND_BORDER}" border-radius="0 0 14px 14px" padding="20px 40px 24px 40px">
      <mj-column>
        <mj-text font-size="13px" color="#5A6170">{{#if footerNote}}<p style="margin:0">{{footerNote}}</p>{{/if}}{{#if bandLinksHtml}}<p style="margin:0">{{{bandLinksHtml}}}</p>{{/if}}{{{regionFooter}}}</mj-text>
      </mj-column>
    </mj-section>
    {{/if}}
    </mj-wrapper>
    <mj-section padding="20px 24px 48px 24px">
      <mj-column>
        <mj-text font-size="12px" color="#5A6170" align="center">{{{mailFooterHtml}}}</mj-text>
      </mj-column>
    </mj-section>
  </mj-body>
</mjml>`;
}

export type StructuredLayoutInput = {
  readonly layoutHtml: string;
  readonly contentHtml: string;
  /** Layout context (lang, tenantName, subject, previewText, signature, imprint, unsubscribeUrl). */
  readonly context: Readonly<Record<string, unknown>>;
  /** Compiles Handlebars source with the renderer's isolated instance and helper set. */
  readonly compile: (source: string) => (context: Readonly<Record<string, unknown>>) => string;
  /** src for `img[data-resource]` in the regions; without it layout images are dropped. */
  readonly resourceSrc?: (key: string) => string | undefined;
  /** Parsed layout appearance; defaults apply when missing. */
  readonly appearance?: MailLayoutAppearance;
  /** Tenant branding accent color for the accent line; ignored unless it is a #rrggbb hex. */
  readonly accentColor?: string;
  /** Colors of the mail's tone; when set, the top line and the header chip use them. */
  readonly tone?: ToneColors;
  /** Escaped brand row built in code; replaces the header region (in-code layout only). */
  readonly brandHeaderHtml?: string;
  /** Plain text of the header chip, escaped here. */
  readonly headerChip?: string;
  /** Plain text above the card's footer links, escaped here. */
  readonly footerNote?: string;
  /** Escaped site and unsubscribe links from buildMailBandLinksHtml. */
  readonly bandLinksHtml?: string;
  /** Escaped platform line from buildMailFooterHtml; rendered below the card, never editable. */
  readonly footerHtml?: string;
};

function topLineColor(input: StructuredLayoutInput, appearance: MailLayoutAppearance) {
  if (input.tone !== undefined) return input.tone.bar;
  return appearance.accentLine ? input.accentColor : undefined;
}

export function renderStructuredLayoutMjml(input: StructuredLayoutInput): string {
  const regions = readLayoutRegions(input.layoutHtml);
  const renderRegion = (region: string, maxHeightPx?: number): string =>
    region.trim() === ""
      ? ""
      : input.compile(
          compileDocumentBodyToHandlebars(
            region,
            {},
            {
              ...(input.resourceSrc && { resourceSrc: input.resourceSrc }),
              resourceImageMaxWidthPx: MAIL_IMAGE_MAX_WIDTH_PX,
              ...(maxHeightPx !== undefined && { resourceImageMaxHeightPx: maxHeightPx }),
            },
          ),
        )(input.context);
  const appearance = input.appearance ?? mailLayoutAppearance({});
  const frame = structuredLayoutFrame(appearance, topLineColor(input, appearance));
  const headerLeft =
    input.brandHeaderHtml ?? renderRegion(regions.header, MAIL_HEADER_IMAGE_MAX_HEIGHT_PX);
  const chip = input.headerChip ?? "";
  const regionFooter = renderRegion(regions.footer);
  const footerNote = input.footerNote?.trim() ?? "";
  const bandLinksHtml = input.bandLinksHtml ?? "";
  return input.compile(frame)({
    ...input.context,
    content: input.contentHtml,
    headerRowHtml:
      input.tone === undefined || chip.trim() === ""
        ? headerLeft
        : headerRowHtml(headerLeft, chip, input.tone),
    regionSignature: renderRegion(regions.signature),
    regionFooter,
    footerNote,
    bandLinksHtml,
    mailFooterHtml: input.footerHtml ?? "",
    hasBand: regionFooter !== "" || footerNote !== "" || bandLinksHtml !== "",
  });
}
