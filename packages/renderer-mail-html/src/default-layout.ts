// Default MJML layout that apps can use out of the box for welcome/reset/invite/
// notification mails. The plugin falls back to it when neither tenant nor system
// has a "mail-layout" template in the DB.
//
// **Variables the layout expects:**
//   - {{appName}}     — header + footer
//   - {{{content}}}   — triple-stash (unescaped) — HTML block rendered from the
//                       content markdown, placed in the mj-raw slot
//   - {{unsubscribeUrl}} — optional, only if a footer link is wanted
//
// **Tenant override:** an app author can create their own "mail-layout" via
// `template-resolver:upsertTenantTemplate`; the plugin then uses that.
// The format is always `kind="mail-html"`, `format="mjml"`.

export const DEFAULT_MAIL_LAYOUT_MJML = `<mjml>
  <mj-head>
    <mj-title>{{appName}}</mj-title>
    <mj-attributes>
      <mj-all font-family="Helvetica, Arial, sans-serif" />
      <mj-text font-size="14px" color="#333" line-height="1.6" />
    </mj-attributes>
  </mj-head>
  <mj-body background-color="#f5f5f5">
    <mj-section background-color="#ffffff" padding="20px">
      <mj-column>
        <mj-text font-size="22px" font-weight="bold" color="#111">{{appName}}</mj-text>
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
          Sent by {{appName}}{{#if unsubscribeUrl}} · <a href="{{unsubscribeUrl}}">Unsubscribe</a>{{/if}}
        </mj-text>
      </mj-column>
    </mj-section>
  </mj-body>
</mjml>`;
