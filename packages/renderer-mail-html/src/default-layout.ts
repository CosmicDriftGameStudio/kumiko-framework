// Default MJML layout that apps can use out of the box for mail templates. The
// renderer falls back to it when neither tenant nor system has a "mail-layout"
// template with the requested slug (default: "default").
//
// **Variables the layout receives (nothing else):**
//   - {{tenantName}}      - header + footer
//   - {{{content}}}       - the rendered mail body (escaped values), triple-stash
//   - {{subject}}         - mj-title
//   - {{previewText}}     - inbox preview line
//   - {{unsubscribeUrl}}  - optional footer link
//
// **Tenant override:** upsert a template of kind "mail-layout", contentFormat
// "mjml", slug "default" (or the slug a mail names in meta.layoutSlug).

export const DEFAULT_MAIL_LAYOUT_SLUG = "default";

export const DEFAULT_MAIL_LAYOUT_MJML = `<mjml>
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
        <mj-raw>{{{content}}}</mj-raw>
      </mj-column>
    </mj-section>
    <mj-section background-color="#f5f5f5" padding="20px">
      <mj-column>
        <mj-text font-size="11px" color="#888" align="center">
          {{#if tenantName}}Sent by {{tenantName}}{{/if}}{{#if unsubscribeUrl}} · <a href="{{link unsubscribeUrl}}">Unsubscribe</a>{{/if}}
        </mj-text>
      </mj-column>
    </mj-section>
  </mj-body>
</mjml>`;
