// Renders a structured (html) mail layout: the tenant-editable regions go into
// a fixed in-code MJML frame, so a tenant layout never contributes MJML source.

import {
  compileDocumentBodyToHandlebars,
  isHexColor,
  type MailLayoutAppearance,
  mailLayoutAppearance,
  readLayoutRegions,
} from "@cosmicdrift/kumiko-bundled-features/template-resolver";
import { escapeHtmlAttr } from "@cosmicdrift/kumiko-headless";

// The logo of a mail layout and of a mail body is capped here; the editors show the same width.
export const MAIL_IMAGE_MAX_WIDTH_PX = 180;

// Appearance values are enum members or a strict hex (see mailLayoutAppearance / isHexColor),
// so interpolating them into the frame cannot inject MJML; the escaping keeps that if the schema widens.
function structuredLayoutFrame(appearance: MailLayoutAppearance, accentColor: string | undefined) {
  const accentLine =
    appearance.accentLine && accentColor !== undefined && isHexColor(accentColor)
      ? `<mj-section background-color="${escapeHtmlAttr(accentColor)}" padding="0">
      <mj-column padding="0">
        <mj-spacer height="4px" padding="0" />
      </mj-column>
    </mj-section>`
      : "";
  return `<mjml>
  <mj-head>
    <mj-title>{{subject}}</mj-title>
    <mj-preview>{{previewText}}</mj-preview>
    <mj-attributes>
      <mj-all font-family="${escapeHtmlAttr(appearance.fontFamily)}" />
      <mj-text font-size="14px" color="#333" line-height="1.6" />
    </mj-attributes>
  </mj-head>
  <mj-body width="${appearance.width}px" background-color="${escapeHtmlAttr(appearance.outerBackground)}">
    ${accentLine}
    {{#if regionHeader}}
    <mj-section background-color="#ffffff" padding="20px">
      <mj-column>
        <mj-text>{{{regionHeader}}}</mj-text>
      </mj-column>
    </mj-section>
    {{/if}}
    <mj-section background-color="#ffffff" padding="20px">
      <mj-column>
        <mj-text>{{{content}}}</mj-text>
      </mj-column>
    </mj-section>
    {{#if regionSignature}}
    <mj-section background-color="#ffffff" padding="20px">
      <mj-column>
        <mj-text>{{{regionSignature}}}</mj-text>
      </mj-column>
    </mj-section>
    {{/if}}
    {{#if regionFooter}}
    <mj-section background-color="${escapeHtmlAttr(appearance.outerBackground)}" padding="20px">
      <mj-column>
        <mj-text font-size="11px" color="#888" align="center">{{{regionFooter}}}</mj-text>
      </mj-column>
    </mj-section>
    {{/if}}
  </mj-body>
</mjml>`;
}

export type StructuredLayoutInput = {
  readonly layoutHtml: string;
  readonly contentHtml: string;
  /** Layout context (tenantName, subject, previewText, signature, imprint, unsubscribeUrl). */
  readonly context: Readonly<Record<string, unknown>>;
  /** Compiles Handlebars source with the renderer's isolated instance and helper set. */
  readonly compile: (source: string) => (context: Readonly<Record<string, unknown>>) => string;
  /** src for `img[data-resource]` in the regions; without it layout images are dropped. */
  readonly resourceSrc?: (key: string) => string | undefined;
  /** Parsed layout appearance; defaults apply when missing. */
  readonly appearance?: MailLayoutAppearance;
  /** Tenant branding accent color for the accent line; ignored unless it is a #rrggbb hex. */
  readonly accentColor?: string;
};

export function renderStructuredLayoutMjml(input: StructuredLayoutInput): string {
  const regions = readLayoutRegions(input.layoutHtml);
  const renderRegion = (region: string): string =>
    region.trim() === ""
      ? ""
      : input.compile(
          compileDocumentBodyToHandlebars(
            region,
            {},
            {
              ...(input.resourceSrc && { resourceSrc: input.resourceSrc }),
              resourceImageMaxWidthPx: MAIL_IMAGE_MAX_WIDTH_PX,
            },
          ),
        )(input.context);
  const frame = structuredLayoutFrame(
    input.appearance ?? mailLayoutAppearance({}),
    input.accentColor,
  );
  return input.compile(frame)({
    ...input.context,
    content: input.contentHtml,
    regionHeader: renderRegion(regions.header),
    regionSignature: renderRegion(regions.signature),
    regionFooter: renderRegion(regions.footer),
  });
}
