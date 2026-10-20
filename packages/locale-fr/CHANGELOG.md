# @cosmicdrift/kumiko-locale-fr

## 0.378.0

### Minor Changes

- a08f6d6: The tenant "Email sending" screen is a standard settings form. The provider is a select with "Platform sending (default)" and "Own SMTP server"; the SMTP fields sit in the same form with one save.
  
  A selector owner without panels now generates one configEdit screen `<owner>-tenant` instead of a dashboard around a dormant `<owner>-tenant-selection` form. The provider select gets an empty option for "no own provider", labelled by `<field label key>.platformDefault` or the generic `config.settings.provider.platformDefault`.
  
  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: Extension-selector settings form is one standard configEdit screen
  detail: Without owner panels the provider form is the `<owner>-tenant` screen itself (no dashboard, no `<owner>-tenant-selection`). The provider select offers an empty "platform default" option next to the plugin ids.
  -->
  
  <!-- kumiko-changes
  feature: mail-foundation
  type: improvement
  title: Email sending offers a platform default and an own SMTP server
  detail: The provider field is labelled "Send via" with the options "Platform sending (default)" (empty, saved as "") and "Own SMTP server"; the SMTP fields show only while the own server is picked.
  -->
- a08f6d6: Only the SystemAdmin edits templates by default. An app unlocks TenantAdmins per kind and slug with `createTemplateResolverFeature({ tenantEditable: [{ kind, slug, access }] })`; reading and delivery are unchanged. Template collections without an `access` rule are SystemAdmin-only. The document designer takes `createDocumentDesignerFeature({ access })` for its editor screens, and `composeRendererStack` passes `templateResolver` options through.
  
  <!-- kumiko-changes
  feature: template-resolver
  type: breaking
  title: Template editing is SystemAdmin-only unless the app unlocks it
  detail: Every tenant write handler, the overview and resource upload accept SystemAdmin only, plus the roles of the tenantEditable entries. A write on a template that is not unlocked fails with templateNotTenantEditable. The test send follows the same rule. For a non-SystemAdmin an unknown template id answers 403 like a locked one, so the response does not reveal whether it exists. Collections without an access rule default to SystemAdmin.
  migration: Where TenantAdmins must keep editing a template, pass tenantEditable to createTemplateResolverFeature, for example tenantEditable: [{ kind: "mail", slug: "billing:notify:invoice-issued", access: { roles: ["TenantAdmin"] } }]. Give template collections an explicit access rule if tenants should manage them.
  -->
  
  <!-- kumiko-changes
  feature: document-designer
  type: breaking
  title: Designer screens are SystemAdmin-only unless the app passes access
  detail: The templates screen, layout, PDF and mail editors are visible to SystemAdmin only by default. createDocumentDesignerFeature takes an optional access rule whose roles are added.
  migration: Pass createDocumentDesignerFeature({ access: templateEditAccess(tenantEditable) }) with the same entries given to the template resolver when TenantAdmins edit templates.
  -->
  
  <!-- kumiko-changes
  feature: dev-server
  type: improvement
  title: composeRendererStack forwards templateResolver options
  detail: RendererStackOptions.templateResolver is passed to createTemplateResolverFeature, so an app can set tenantEditable.
  -->

### Patch Changes

- 2d7ee3e: Document PDFs can embed the images of a record
  
  <!-- kumiko-changes
  feature: template-resolver
  type: improvement
  title: Document PDFs embed the images of a record
  detail: A template variable of type images (templateVariable.images()) holds FileRef ids of the record. The new Images block (div[data-images], PDF templates only, rejected for mail kinds) renders them as data-URI images in the real PDF render. Only files of the rendering tenant are read, only png, jpeg, gif and webp, at most 24 images and 20 MB per document; missing, foreign, oversized or non-image ids are dropped silently. Previews and draft PDFs never read files and show one placeholder box per block. An images variable never renders as inline text. i18n keys template-resolver.documentEditor.images, template-resolver.documentEditor.imagesVariable and templateResolver.errors.document.imagesBlockPdfOnly ship in de, es, fr and it.
  migration: Declare a template variable with type `images`, place the Images block, and pass FileRef ids of the record in `variables`. Images resolve only in the real PDF render, previews show placeholders. The ids must come from the record on the server, never from client input: a resolved id is read for the whole tenant without an entity access check.
  -->
- f47cbd1: Files fields show download and PDF preview on detail screens
  
  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: Files fields show download and PDF preview
  detail: A read-only detail field with renderer { format: "file" } (projectionDetail, readOnly edit field) lists each file with its name and a download link; PDFs get an inline preview toggle. New optional primitive FileValueList, and PdfPreview (moved here from the document designer) with a per-source bounded document cache so several PDFs can share a page. i18n keys kumiko.field.file-list.download/preview/hidePreview and kumiko.widget.pdf-preview.* ship in de, es, fr and it.
  migration: PdfPreview is now exported from @cosmicdrift/kumiko-renderer/web (props: source {base64}|{url}, testId).
  -->
- Updated dependencies [2d7ee3e]
- Updated dependencies [0250376]
- Updated dependencies [a08f6d6]
- Updated dependencies [6352d97]
  - @cosmicdrift/kumiko-framework@0.378.0

## 0.377.0

### Patch Changes

- Updated dependencies [e552c13]
- Updated dependencies [c00af64]
- Updated dependencies [60a29a8]
- Updated dependencies [9400d43]
- Updated dependencies [c00af64]
- Updated dependencies [c00af64]
- Updated dependencies [fd450c2]
  - @cosmicdrift/kumiko-framework@0.377.0

## 0.376.0

### Patch Changes

- Updated dependencies [6a15526]
- Updated dependencies [e3e3faa]
  - @cosmicdrift/kumiko-framework@0.376.0

## 0.375.0

### Patch Changes

- 5c7b19e: Template documents can be read as blocks and patched as a draft
  
  <!-- kumiko-changes
  feature: template-resolver
  type: improvement
  title: Read a mail or PDF template as blocks and change it with structured operations
  detail: The query `template-resolver:query:document-blocks` returns a document template as blocks with stable ids (b0, b1, ...), its meta, variables, allowed block types and uploaded image keys, plus a `base` (scope and version). The write `template-resolver:write:patch-draft` applies up to 50 operations (insertBlock, replaceText, removeBlock, setResource, setMeta, setVariable) to that state and stores the result as the caller's tenant draft; an active version keeps being served until publish. Block ids refer to the state that was read. If the template changed since `base` was read, the call fails with `version_conflict` and writes nothing; a patch that removes a required placeholder or sets variables a notification declares is refused. `writeTemplateRow` accepts an optional `expectedVersion`. The universal helpers `placeholder-text` and the toolbar block sets moved out of `web/` without changing the web exports.
  -->
- @cosmicdrift/kumiko-framework@0.375.0

## 0.374.0

### Minor Changes

- 926e08e: Dashboards bound to a record, with header actions, auto refresh and relative times
  
  `DashboardScreenDefinition.record: { param, payloadKey?, query?, titleField? }` ties a dashboard to one record via a URL search param. The id is merged into every panel and `visibleWhen` gate query after `filter`/`timeRange` and before a panel's own `params`; screen-kind panels get none. Without the param the dashboard shows a hint (`kumiko.dashboard.record.missing`) and runs no query. `record.query` loads the record row for the page title (`titleField`), the actions and `refresh.field`.
  
  `actions` puts writeHandler, navigate and clientAction actions in the dashboard header, running on the record row (or `{ id, [payloadKey]: id }` without `record.query`). After a success the record and all panels refetch. The header bar is the shared `HeaderActionsBar` component also used by projectionDetail. Boot rejects actions without `record`, drawer actions, `rowClick` and `redirect`.
  
  `refresh: { seconds } | { field }` polls the record and all panels, never faster than 5 s (`DASHBOARD_MIN_REFRESH_SECONDS`): boot rejects `seconds` below it, a `field` value is clamped at runtime. A running refetch is never stacked and polling stops on unmount.
  
  `valueFormat: { kind: "relativeTime" }` on stat panels and `{ kind: "relativeTime", atMs }` as a text param render epoch ms via `Intl.RelativeTimeFormat` in the user locale ("5 minutes ago", "in 30 seconds") and keep ticking while mounted.
  
  fillAction is only allowed on text, number, decimal and bigInt fields and rejected on password, sensitive and writeOnly ones; an actionForm `load` never fills those fields from the loaded record. The email clientActions answer a 429 with the new `auth.errors.tooManyRequests` instead of the login-specific rate-limit text.
  
  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: Dashboard record binding, header actions, refresh and relative time
  detail: Dashboards take record, actions and refresh; stat panels and text params gain a relativeTime format; the surface keys include kumiko.dashboard.record.missing.
  -->
  
  <!-- kumiko-changes
  feature: framework
  type: breaking
  title: DashboardChartPanel.valueFormat only takes the currency format
  detail: DashboardValueFormat is now a union of DashboardCurrencyFormat and DashboardRelativeTimeFormat. Stat panels take both, chart panels only the currency one, and boot rejects relativeTime on a chart.
  migration: A chart panel that declares valueFormat keeps working with { kind: "currency", currency }. Code that types a chart's valueFormat as DashboardValueFormat should use DashboardCurrencyFormat instead; relativeTime on a chart was never meaningful and now fails boot.
  -->
- 8e735ed: progress-list rows take used/limit, an unlimited state and a danger tone
  
  A `progress-list` row may return `used` and `limit` (`number | null`) instead of `value` and `fraction`. The panel shows "used / limit" with the viewer's number format and fills the bar with `used / limit`. `limit: null` shows "used / unlimited" without a bar. The new row field `tone` (`DashboardProgressTone`: `"default" | "danger"`) colors bar and value; used/limit rows turn `danger` automatically once `used >= limit`, and an explicit `tone` wins. `ProgressListRow.fraction` accepts `null` (no bar) and gains `tone`. New translation key `kumiko.dashboard.progress.unlimited` in the defaults and the de, es, fr and it bundles.
  
  <!-- kumiko-changes
  feature: renderer-web
  type: improvement
  title: progress-list rows take used/limit, an unlimited state and a danger tone
  detail: A progress-list row may return used and limit (number or null) instead of value and fraction; limit null shows "used / unlimited" without a bar. Row tone "danger" (automatic once used >= limit in used/limit rows) colors bar and value. ProgressListRow.fraction accepts null and gains tone.
  -->
  
  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: DashboardProgressTone type and unlimited label key
  detail: New exported type DashboardProgressTone for progress-list row tones. The default translations gain kumiko.dashboard.progress.unlimited.
  -->

### Patch Changes

- Updated dependencies [40b8667]
- Updated dependencies [de5d674]
- Updated dependencies [47e3a05]
- Updated dependencies [926e08e]
- Updated dependencies [1d72366]
- Updated dependencies [c3df9a2]
- Updated dependencies [1b710f1]
- Updated dependencies [8e735ed]
- Updated dependencies [fc221ab]
  - @cosmicdrift/kumiko-framework@0.374.0

## 0.373.0

### Patch Changes

- Updated dependencies [6913834]
- Updated dependencies [6913834]
  - @cosmicdrift/kumiko-framework@0.373.0

## 0.372.0

### Minor Changes

- e36d480: French and Italian UI and mail copy
  
  Two new opt-in packages ship French and Italian copy for the framework screens and mails. Mount `localeFr()` + `localeFrClient()` or `localeIt()` + `localeItClient()`; for mail copy only, call `registerMailTranslations("fr", localeFrBundle)` (or `"it"` with `localeItBundle`).
  
  <!-- kumiko-changes
  feature: locale-fr
  type: improvement
  title: New opt-in package kumiko-locale-fr ships French framework copy
  detail: Same shape as kumiko-locale-es; not included by includeBundled.
  -->
  
  <!-- kumiko-changes
  feature: locale-it
  type: improvement
  title: New opt-in package kumiko-locale-it ships Italian framework copy
  detail: Same shape as kumiko-locale-es; not included by includeBundled.
  -->

### Patch Changes

- 7c04d2a: Screen-reader labels in the app shell are translated
  
  <!-- kumiko-changes
  feature: renderer-web
  type: fix
  title: Sidebar, breadcrumb, drawer and table labels for screen readers follow the user's language
  detail: The sidebar toggle ("Toggle Sidebar"), the sidebar rail, the title of the mobile sidebar sheet, the breadcrumb landmark, the drawer's close button, the close button of the workspace editor panel and the actions column of tables had hard-coded English names. They now come from the translations in de, en, es, fr and it (`kumiko.sidebar.*`, `kumiko.breadcrumb.label`, `kumiko.list.actions`, `kumiko.dialog.close`).
  -->
- Updated dependencies [a4401ab]
- Updated dependencies [de53a14]
- Updated dependencies [236858e]
- Updated dependencies [5cd8710]
- Updated dependencies [27b759f]
- Updated dependencies [221f81c]
- Updated dependencies [dca222d]
- Updated dependencies [2cb8b4f]
- Updated dependencies [4224023]
- Updated dependencies [9bc4bc4]
  - @cosmicdrift/kumiko-framework@0.372.0
