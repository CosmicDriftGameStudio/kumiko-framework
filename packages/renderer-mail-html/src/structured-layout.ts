// Renders a structured (html) mail layout: the tenant-editable regions go into
// a fixed in-code MJML frame, so a tenant layout never contributes MJML source.

import {
  compileDocumentBodyToHandlebars,
  readLayoutRegions,
} from "@cosmicdrift/kumiko-bundled-features/template-resolver";

const STRUCTURED_LAYOUT_FRAME = `<mjml>
  <mj-head>
    <mj-title>{{subject}}</mj-title>
    <mj-preview>{{previewText}}</mj-preview>
    <mj-attributes>
      <mj-all font-family="Helvetica, Arial, sans-serif" />
      <mj-text font-size="14px" color="#333" line-height="1.6" />
    </mj-attributes>
  </mj-head>
  <mj-body background-color="#f5f5f5">
    {{#if regionHeader}}
    <mj-section background-color="#ffffff" padding="20px">
      <mj-column>
        <mj-text>{{{regionHeader}}}</mj-text>
      </mj-column>
    </mj-section>
    {{/if}}
    <mj-section background-color="#ffffff" padding="20px">
      <mj-column>
        <mj-raw>{{{content}}}</mj-raw>
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
    <mj-section background-color="#f5f5f5" padding="20px">
      <mj-column>
        <mj-text font-size="11px" color="#888" align="center">{{{regionFooter}}}</mj-text>
      </mj-column>
    </mj-section>
    {{/if}}
  </mj-body>
</mjml>`;

export type StructuredLayoutInput = {
  readonly layoutHtml: string;
  readonly contentHtml: string;
  /** Layout context (tenantName, subject, previewText, signature, imprint, unsubscribeUrl). */
  readonly context: Readonly<Record<string, unknown>>;
  /** Compiles Handlebars source with the renderer's isolated instance and helper set. */
  readonly compile: (source: string) => (context: Readonly<Record<string, unknown>>) => string;
};

export function renderStructuredLayoutMjml(input: StructuredLayoutInput): string {
  const regions = readLayoutRegions(input.layoutHtml);
  const renderRegion = (region: string): string =>
    region.trim() === ""
      ? ""
      : input.compile(compileDocumentBodyToHandlebars(region, {}))(input.context);
  return input.compile(STRUCTURED_LAYOUT_FRAME)({
    ...input.context,
    content: input.contentHtml,
    regionHeader: renderRegion(regions.header),
    regionSignature: renderRegion(regions.signature),
    regionFooter: renderRegion(regions.footer),
  });
}
