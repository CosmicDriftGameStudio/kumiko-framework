// Default MJML layout that apps can seed as their editable system layout
// (seedSystemMailLayout). Without any layout row the renderer uses an in-code
// structured layout instead, which also shows the branding logo and accent.
//
// **Variables the layout receives (nothing else):**
//   - {{tenantName}}      - header
//   - {{mailSentBy}}      - "Sent by <tenant>" in the mail locale, empty without a tenant name
//   - {{{content}}}       - the rendered mail body (escaped values), triple-stash.
//                           It sits in mj-text: mj-raw would put block HTML straight into
//                           the column tbody, where browsers move it out of the table into
//                           the column div with font-size 0, so the body turns invisible.
//   - {{subject}}         - mj-title
//   - {{previewText}}     - inbox preview line
//   - {{unsubscribeUrl}}  - optional footer link
//   - {{lang}}            - the mail locale for <mjml lang>
//   - {{imprint}}         - imprint URL from the app's footer resolver
//   - {{{mailFooterHtml}}} - escaped footer line (resolver text, imprint, privacy,
//                           unsubscribe link), built in code
//
// **Tenant override:** upsert a template of kind "mail-layout", contentFormat
// "html" (structured: data-content slot plus header/signature/footer regions),
// slug "default" (or the slug a mail names in meta.layoutSlug). Raw mjml is
// system-only.

export { DEFAULT_MAIL_LAYOUT_SLUG } from "@cosmicdrift/kumiko-bundled-features/template-resolver";

export const DEFAULT_MAIL_LAYOUT_MJML = `<mjml lang="{{lang}}">
  <mj-head>
    <mj-title>{{subject}}</mj-title>
    <mj-preview>{{previewText}}</mj-preview>
    <mj-attributes>
      <mj-all font-family="Helvetica, Arial, sans-serif" />
      <mj-text font-size="14px" color="#333" line-height="1.6" />
    </mj-attributes>
  </mj-head>
  <mj-body background-color="#f5f5f5">
    <mj-section background-color="#ffffff" padding="20px">
      <mj-column>
        <mj-text font-size="22px" font-weight="bold" color="#111">{{tenantName}}</mj-text>
      </mj-column>
    </mj-section>
    <mj-section background-color="#ffffff" padding="20px">
      <mj-column>
        <mj-text>{{{content}}}</mj-text>
      </mj-column>
    </mj-section>
    <mj-section background-color="#f5f5f5" padding="20px">
      <mj-column>
        <mj-text font-size="11px" color="#888" align="center">
          {{#if mailSentBy}}<p>{{mailSentBy}}</p>{{/if}}{{#if mailFooterHtml}}<p>{{{mailFooterHtml}}}</p>{{/if}}
        </mj-text>
      </mj-column>
    </mj-section>
  </mj-body>
</mjml>`;
