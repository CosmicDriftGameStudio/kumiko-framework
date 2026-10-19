# @cosmicdrift/kumiko-document-designer

## 0.377.0

### Patch Changes

- c00af64: kumiko-headless moves into kumiko-renderer as `@cosmicdrift/kumiko-renderer/headless` and kumiko-dispatcher-live as `@cosmicdrift/kumiko-renderer/live`. The old packages stay as deprecated re-export shims until the consumer pass of wave 4. The `package-merge` codemod rewrites imports and package.json dependencies for both moves.
  
  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: headless and the live dispatcher moved into renderer
  detail: The headless UI logic is exported from @cosmicdrift/kumiko-renderer/headless (with /headless/apex, /headless/dispatcher and /headless/locale-routing), the HTTP dispatcher from @cosmicdrift/kumiko-renderer/live. @cosmicdrift/kumiko-headless and @cosmicdrift/kumiko-dispatcher-live now only re-export these subpaths and are removed after the consumer pass of wave 4.
  migration: Run bun kumiko-upgrade --apply, or bun kumiko codemod package-merge . --write. It rewrites imports of @cosmicdrift/kumiko-headless (and its subpaths) to @cosmicdrift/kumiko-renderer/headless and imports of @cosmicdrift/kumiko-dispatcher-live to @cosmicdrift/kumiko-renderer/live, and replaces both dependencies in package.json with kumiko-renderer.
  codemod: scripts/codemod/package-merge.ts
  -->
  
  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: package-merge codemod covers headless and dispatcher-live
  detail: The mapping table of the package-merge codemod gained the headless and dispatcher-live moves into kumiko-renderer.
  codemod: scripts/codemod/package-merge.ts
  -->
  
  <!-- kumiko-changes
  feature: headless
  type: improvement
  title: kumiko-headless is a deprecated shim over kumiko-renderer/headless
  detail: The package only re-exports @cosmicdrift/kumiko-renderer/headless and its subpaths and is removed after the consumer pass of wave 4.
  migration: Import from @cosmicdrift/kumiko-renderer/headless, or run bun kumiko codemod package-merge . --write.
  -->
  
  <!-- kumiko-changes
  feature: dispatcher-live
  type: improvement
  title: kumiko-dispatcher-live is a deprecated shim over kumiko-renderer/live
  detail: The package only re-exports @cosmicdrift/kumiko-renderer/live and is removed after the consumer pass of wave 4.
  migration: Import from @cosmicdrift/kumiko-renderer/live, or run bun kumiko codemod package-merge . --write.
  -->
  
  <!-- kumiko-changes
  feature: guards
  type: improvement
  title: renderer-boundaries guard scans headless and live for imports only
  detail: The headless and live subtrees of kumiko-renderer must not import react-dom, jsdom or renderer-web; the symbol and JSX rules of the shared layer no longer apply to them. The section-fields-raw scope follows the moved headless sources.
  -->
- c00af64: kumiko-renderer-web moves into kumiko-renderer as `@cosmicdrift/kumiko-renderer/web` (with `/web/styles.css` and `/web/theme-plugin`). The old package stays as a deprecated re-export shim until the consumer pass of wave 4. The `package-merge` codemod rewrites imports, package.json dependencies and, new, CSS `@import`/`@plugin`/`@config` specifiers.
  
  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: renderer-web moved into renderer
  detail: The web bindings are exported from @cosmicdrift/kumiko-renderer/web, the stylesheet from @cosmicdrift/kumiko-renderer/web/styles.css and the Tailwind theme plugin from @cosmicdrift/kumiko-renderer/web/theme-plugin. @cosmicdrift/kumiko-renderer-web now only re-exports these and is removed after the consumer pass of wave 4.
  migration: Run bun kumiko-upgrade --apply, or bun kumiko codemod package-merge . --write. It rewrites imports and CSS @import lines of @cosmicdrift/kumiko-renderer-web (including /styles.css and /theme-plugin) to @cosmicdrift/kumiko-renderer/web and replaces the dependency in package.json with kumiko-renderer.
  codemod: scripts/codemod/package-merge.ts
  -->
  
  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: package-merge codemod covers renderer-web and CSS files
  detail: The mapping table of the package-merge codemod gained the renderer-web move into kumiko-renderer/web, and the codemod now also rewrites .css files (@import, @plugin, @config). A @source path into the old package is reported for manual follow-up.
  codemod: scripts/codemod/package-merge.ts
  -->
  
  <!-- kumiko-changes
  feature: renderer-web
  type: improvement
  title: kumiko-renderer-web is a deprecated shim over kumiko-renderer/web
  detail: The package only re-exports @cosmicdrift/kumiko-renderer/web and its theme-plugin, and its styles.css imports the new stylesheet. It is removed after the consumer pass of wave 4.
  migration: Import from @cosmicdrift/kumiko-renderer/web, or run bun kumiko codemod package-merge . --write.
  -->
  
  <!-- kumiko-changes
  feature: guards
  type: improvement
  title: renderer-boundaries guard leaves the web subtree unscanned
  detail: renderer/src/web may use the DOM and every web dependency; the shared renderer root and headless/live must not import it. The tailwind-scan-surface guard follows the new stylesheet location through package exports and shim imports.
  -->
  
  <!-- kumiko-changes
  feature: guards
  type: improvement
  title: comment-lang touched mode pairs renames
  detail: The touched mode diffs a moved file against its old path, so moving a file no longer counts every German comment in it as new.
  -->
  
  <!-- kumiko-changes
  feature: cli
  type: fix
  title: project rebuild keeps blind indexes and aborts without crypto, events prune names its aggregate types
  detail: `kumiko project rebuild` now wires the subject KMS and blind-index key from the env like `schema apply` and `ops backfill-pii`, so rebuilding a PII projection no longer nulls its bidx columns. Without the crypto env an app with PII fields aborts the rebuild unless `--allow-plaintext-pii <reason>` is passed. `kumiko events prune` takes the required `--aggregate-types <a,b>` flag; before, it always failed because pruneEvents needs explicit aggregate types.
  -->
- Updated dependencies [ae10fa6]
- Updated dependencies [e552c13]
- Updated dependencies [e3ecf83]
- Updated dependencies [c00af64]
- Updated dependencies [60a29a8]
- Updated dependencies [9400d43]
- Updated dependencies [c00af64]
- Updated dependencies [c00af64]
- Updated dependencies [fd450c2]
  - @cosmicdrift/kumiko-bundled-features@0.377.0
  - @cosmicdrift/kumiko-renderer@0.377.0
  - @cosmicdrift/kumiko-framework@0.377.0
  - @cosmicdrift/kumiko-types@0.377.0
  - @cosmicdrift/kumiko-renderer-puppeteer-client@0.377.0

## 0.376.0

### Patch Changes

- Updated dependencies [05ba6c5]
- Updated dependencies [5274ebc]
- Updated dependencies [6a15526]
- Updated dependencies [e3e3faa]
  - @cosmicdrift/kumiko-bundled-features@0.376.0
  - @cosmicdrift/kumiko-types@0.376.0
  - @cosmicdrift/kumiko-framework@0.376.0
  - @cosmicdrift/kumiko-renderer-puppeteer-client@0.376.0
  - @cosmicdrift/kumiko-headless@0.376.0
  - @cosmicdrift/kumiko-renderer@0.376.0
  - @cosmicdrift/kumiko-renderer-web@0.376.0

## 0.375.0

### Minor Changes

- 4ca58ad: Template preview and test mail can render with chosen values
  
  <!-- kumiko-changes
  feature: template-resolver
  type: improvement
  title: Preview and test mail render with the values of a picked record
  detail: `template-resolver:query:preview` and `template-resolver:write:send-test` accept an optional `variables` object that replaces the declared example values for the named variables. The values are checked against the template's variable schema like a real send (unknown names and wrong types are rejected as `variables.<name>` validation errors); variables not passed keep their example. The mail editor now passes the values picked through the preview record picker into the preview and the test mail instead of only listing them.
  -->

### Patch Changes

- Updated dependencies [4ca58ad]
- Updated dependencies [5c7b19e]
  - @cosmicdrift/kumiko-bundled-features@0.375.0
  - @cosmicdrift/kumiko-renderer-puppeteer-client@0.375.0
  - @cosmicdrift/kumiko-renderer@0.375.0
  - @cosmicdrift/kumiko-renderer-web@0.375.0
  - @cosmicdrift/kumiko-framework@0.375.0
  - @cosmicdrift/kumiko-headless@0.375.0
  - @cosmicdrift/kumiko-types@0.375.0

## 0.374.0

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
  - @cosmicdrift/kumiko-types@0.374.0
  - @cosmicdrift/kumiko-framework@0.374.0
  - @cosmicdrift/kumiko-headless@0.374.0
  - @cosmicdrift/kumiko-renderer@0.374.0
  - @cosmicdrift/kumiko-renderer-web@0.374.0
  - @cosmicdrift/kumiko-bundled-features@0.374.0
  - @cosmicdrift/kumiko-renderer-puppeteer-client@0.374.0

## 0.373.0

### Patch Changes

- Updated dependencies [6913834]
- Updated dependencies [6913834]
  - @cosmicdrift/kumiko-framework@0.373.0
  - @cosmicdrift/kumiko-types@0.373.0
  - @cosmicdrift/kumiko-bundled-features@0.373.0
  - @cosmicdrift/kumiko-headless@0.373.0
  - @cosmicdrift/kumiko-renderer@0.373.0
  - @cosmicdrift/kumiko-renderer-puppeteer-client@0.373.0
  - @cosmicdrift/kumiko-renderer-web@0.373.0

## 0.372.0

### Patch Changes

- 7c04d2a: Designer shows placeholder labels instead of raw names
  
  <!-- kumiko-changes
  feature: document-designer
  type: fix
  title: The designer names placeholders by their label everywhere
  detail: Placeholder chips in the mail subject, the header label, the footer note and the paper editor now show only the variable's label; the raw name stays available as a tooltip. The tone select reads "From placeholder: <label>" instead of "{{tone}}", and the validation notes in the preview list labels instead of names. The file-name hint in the settings is translated (de, en, es). Unknown placeholders and variables without a label still show their name.
  -->
- 7c04d2a: Designer sample values show money and dates like the rendered mail
  
  <!-- kumiko-changes
  feature: document-designer
  type: fix
  title: Sample values show formatted money and dates
  detail: The sample-values bar in the mail preview formats money, dates and percentages in the language of the selected tab and with the tenant currency, through the same helpers the mail and PDF renderers use (formatDocumentMoney, formatDocumentDate and formatDocumentPercent, now exported from kumiko-headless). An amount reads "1.284,50 €" instead of "128450 EUR". The required star in the placeholder list stays on the label's last word instead of wrapping onto its own line. config/web now exports ConfigQueries.
  -->
- 5cd8710: Empty values use one placeholder everywhere
  
  <!-- kumiko-changes
  feature: renderer
  type: fix
  title: Empty values use one placeholder everywhere
  detail: Empty table cells, reference columns, read-only fields and dashboard lists now share one em dash placeholder (exported as EMPTY_VALUE_PLACEHOLDER from the headless package) instead of mixing en and em dashes.
  -->
- Updated dependencies [a4401ab]
- Updated dependencies [de53a14]
- Updated dependencies [16ab9fe]
- Updated dependencies [7c04d2a]
- Updated dependencies [7c04d2a]
- Updated dependencies [7c04d2a]
- Updated dependencies [5cd8710]
- Updated dependencies [236858e]
- Updated dependencies [5cd8710]
- Updated dependencies [5cd8710]
- Updated dependencies [27b759f]
- Updated dependencies [5cd8710]
- Updated dependencies [5cd8710]
- Updated dependencies [5cd8710]
- Updated dependencies [221f81c]
- Updated dependencies [dca222d]
- Updated dependencies [2cb8b4f]
- Updated dependencies [5cd8710]
- Updated dependencies [7c04d2a]
- Updated dependencies [4224023]
- Updated dependencies [9bc4bc4]
- Updated dependencies [7c04d2a]
  - @cosmicdrift/kumiko-framework@0.372.0
  - @cosmicdrift/kumiko-bundled-features@0.372.0
  - @cosmicdrift/kumiko-headless@0.372.0
  - @cosmicdrift/kumiko-renderer@0.372.0
  - @cosmicdrift/kumiko-renderer-web@0.372.0
  - @cosmicdrift/kumiko-types@0.372.0
  - @cosmicdrift/kumiko-renderer-puppeteer-client@0.372.0

## 0.371.1

### Patch Changes

- 183d968: Document Designer client strings in Spanish
  
  <!-- kumiko-changes
  feature: document-designer
  type: fix
  title: The Document Designer editor shows its own texts in Spanish
  detail: The client translation bundle of the Document Designer (canvas caption, origin bar, tenant customisations, resources, PDF settings, preview and validation messages) had only en and de, so Spanish users saw these texts in English. It now ships an es block that uses tú and the same terms as locale-es (organización, diseño, marcador). A parity test keeps the keys and placeholders of en, de and es aligned.
  -->
- @cosmicdrift/kumiko-bundled-features@0.371.1
  - @cosmicdrift/kumiko-framework@0.371.1
  - @cosmicdrift/kumiko-headless@0.371.1
  - @cosmicdrift/kumiko-renderer@0.371.1
  - @cosmicdrift/kumiko-renderer-puppeteer-client@0.371.1
  - @cosmicdrift/kumiko-renderer-web@0.371.1
  - @cosmicdrift/kumiko-types@0.371.1

## 0.371.0

### Patch Changes

- Updated dependencies [5a822b2]
  - @cosmicdrift/kumiko-bundled-features@0.371.0
  - @cosmicdrift/kumiko-framework@0.371.0
  - @cosmicdrift/kumiko-renderer@0.371.0
  - @cosmicdrift/kumiko-renderer-puppeteer-client@0.371.0
  - @cosmicdrift/kumiko-headless@0.371.0
  - @cosmicdrift/kumiko-renderer-web@0.371.0
  - @cosmicdrift/kumiko-types@0.371.0

## 0.370.0

### Minor Changes

- 2930518: Mail editor: informal German, tenant sender hint, readable button chips
  
  <!-- kumiko-changes
  feature: document-designer
  type: fix
  title: Designer addresses the user informally in German, points tenant-routed senders to Email sending and renders chips inside buttons
  detail: All German document designer strings use du like the rest of the framework; the formal locale overrides keep Sie. For a notification with tenantTransport the sender hint in the mail editor says the address comes from the tenant's Email sending settings and links to that screen when the app mounts it; TemplateUsageEntry gains tenantTransport. A placeholder chip inside a button block is now drawn in inverted colors so the button text stays readable in the editor.
  -->
- 2930518: Template variable labels can be i18n keys
  
  <!-- kumiko-changes
  feature: template-resolver
  type: improvement
  title: templateVariable label accepts an i18n key; the designer shows the translation instead of the raw name
  detail: A label given as i18n key (templateVariable.text({ label: "billing:mail.variable.invoiceNumber" }) plus r.translations in each locale) is translated in the designer's variable rail, in the chips on the paper, in the steps and repeat block heads, in the placeholder, button, repeat and steps pickers of the editor toolbar and in the missing-variables footer; the raw variable name stays visible as tooltip. Plain-text labels keep working, a key without translation falls back to the key text. The server preview (sampleValuesFor, now with an optional labelText translator) names sample values by the translated label in the draft's locale. variableLabelMap in document-designer now takes the translator as first argument. VariableChips in the renderer takes optional labels.
  -->

### Patch Changes

- Updated dependencies [8ff5d19]
- Updated dependencies [a02e354]
- Updated dependencies [a02e354]
- Updated dependencies [79a0aa6]
- Updated dependencies [2930518]
- Updated dependencies [8ff5d19]
- Updated dependencies [4a6e151]
- Updated dependencies [a02e354]
- Updated dependencies [c051152]
- Updated dependencies [8ff5d19]
- Updated dependencies [75c45e4]
- Updated dependencies [2930518]
- Updated dependencies [2930518]
- Updated dependencies [2930518]
- Updated dependencies [7fa8420]
- Updated dependencies [8ff5d19]
  - @cosmicdrift/kumiko-framework@0.370.0
  - @cosmicdrift/kumiko-bundled-features@0.370.0
  - @cosmicdrift/kumiko-types@0.370.0
  - @cosmicdrift/kumiko-renderer@0.370.0
  - @cosmicdrift/kumiko-headless@0.370.0
  - @cosmicdrift/kumiko-renderer-puppeteer-client@0.370.0
  - @cosmicdrift/kumiko-renderer-web@0.370.0

## 0.369.0

### Patch Changes

- Updated dependencies [57c0cff]
- Updated dependencies [57c0cff]
- Updated dependencies [57c0cff]
- Updated dependencies [57c0cff]
- Updated dependencies [57c0cff]
- Updated dependencies [a4cab24]
  - @cosmicdrift/kumiko-bundled-features@0.369.0
  - @cosmicdrift/kumiko-types@0.369.0
  - @cosmicdrift/kumiko-framework@0.369.0
  - @cosmicdrift/kumiko-renderer@0.369.0
  - @cosmicdrift/kumiko-renderer-puppeteer-client@0.369.0
  - @cosmicdrift/kumiko-headless@0.369.0
  - @cosmicdrift/kumiko-renderer-web@0.369.0

## 0.368.0

### Patch Changes

- Updated dependencies [133ef08]
- Updated dependencies [39b5de4]
- Updated dependencies [1a1b772]
- Updated dependencies [fbc0759]
- Updated dependencies [7949df2]
- Updated dependencies [39b5de4]
- Updated dependencies [39b5de4]
- Updated dependencies [be3c6eb]
- Updated dependencies [be3c6eb]
- Updated dependencies [39b5de4]
- Updated dependencies [39b5de4]
- Updated dependencies [478ee1f]
- Updated dependencies [1404b33]
  - @cosmicdrift/kumiko-framework@0.368.0
  - @cosmicdrift/kumiko-bundled-features@0.368.0
  - @cosmicdrift/kumiko-renderer-puppeteer-client@0.368.0
  - @cosmicdrift/kumiko-types@0.368.0
  - @cosmicdrift/kumiko-renderer@0.368.0
  - @cosmicdrift/kumiko-renderer-web@0.368.0
  - @cosmicdrift/kumiko-headless@0.368.0

## 0.367.0

### Patch Changes

- f6b1803: Template conditions with data-if and a percent variable type
  
  <!-- kumiko-changes
  feature: template-resolver
  type: improvement
  title: Template conditions with data-if and a percent variable type
  detail: A paragraph, heading or table row with data-if="name" renders only when the variable has a value (0 counts as a value); inside a repeat row the name refers to the row field, on the repeat row itself to the root variable. The sanitizer keeps the attribute, and template validation reports a condition on an undeclared variable. New variable type percent (templateVariable.percent()) takes percentage points and renders locale-aware, 12 as "12 %" in German and "12%" in English; the preview uses its example value. The document designer has no toolbar control for conditions yet; the attribute survives editing.
  -->
- Updated dependencies [f6b1803]
- Updated dependencies [10de2c0]
- Updated dependencies [a0db2ac]
- Updated dependencies [f6b1803]
- Updated dependencies [f6b1803]
- Updated dependencies [f6b1803]
- Updated dependencies [f6b1803]
- Updated dependencies [f6b1803]
- Updated dependencies [f6b1803]
- Updated dependencies [f6b1803]
- Updated dependencies [04bf143]
- Updated dependencies [5f2cc2f]
  - @cosmicdrift/kumiko-bundled-features@0.367.0
  - @cosmicdrift/kumiko-renderer@0.367.0
  - @cosmicdrift/kumiko-renderer-web@0.367.0
  - @cosmicdrift/kumiko-types@0.367.0
  - @cosmicdrift/kumiko-framework@0.367.0
  - @cosmicdrift/kumiko-renderer-puppeteer-client@0.367.0
  - @cosmicdrift/kumiko-headless@0.367.0

## 0.366.0

### Patch Changes

- 7053800: The registrar takes one object per call: r.writeHandler, r.queryHandler, r.entity, r.requires and r.hook lose their positional forms
  
  <!-- kumiko-changes
  feature: framework
  type: breaking
  title: Registrar methods take a single object, positional calls throw at registration
  detail: |
    r.writeHandler, r.queryHandler, r.entity, r.requires and r.hook now take one object. The positional overloads are gone from the types and throw when the feature is defined, with a message that points at the codemod. The throw is removed in the first release after 2026-10-29.
  
    writeHandler (queryHandler is the same shape):
      before: r.writeHandler("order:archive", schema, handler, { access });
      after:  r.writeHandler({ name: "order:archive", schema, handler, access });
  
    hook (type picks the handler shape, target is a name, a list or { allOf }):
      before: r.hook("postSave", "order", handler, { escapeHatch });
      after:  r.hook({ type: "postSave", target: "order", handler, escapeHatch });
  
    entity and requires:
      before: r.entity("order", definition, { table: ordersTable });  r.requires("auth", "tenant");
      after:  r.entity({ name: "order", ...definition, backingTable: ordersTable });  r.requires({ features: ["auth", "tenant"] });
  
    registerEntityCrud is no longer exported from @cosmicdrift/kumiko-framework/engine; call r.crud(name, entity, options) instead. The entity option { table } is now backingTable on the r.entity object and lands in the feature's entityTables, not in its entities. HookDefinition and EntityObjectDefinition are exported from @cosmicdrift/kumiko-types. Hook definitions are checked per type: validation takes no escapeHatch, phase only exists on postSave and postDelete, and { allOf } is not accepted on preSave.
  migration: Run `bun kumiko-upgrade --apply`. It rewrites every positional r.writeHandler, r.queryHandler, r.entity, r.requires, r.hook and registerEntityCrud call to the object form. Calls it cannot resolve statically (a spread argument, a registrar that is not typed as FeatureRegistrar) are listed as manual work with file and line; rewrite those by hand.
  codemod: scripts/codemod/object-form.ts
  manualAfterCodemod: true
  -->
- Updated dependencies [09d5344]
- Updated dependencies [22b7f6e]
- Updated dependencies [22b7f6e]
- Updated dependencies [a919906]
- Updated dependencies [15d76a8]
- Updated dependencies [22b7f6e]
- Updated dependencies [22b7f6e]
- Updated dependencies [22b7f6e]
- Updated dependencies [22b7f6e]
- Updated dependencies [8a7d835]
- Updated dependencies [7053800]
- Updated dependencies [3d58dea]
- Updated dependencies [49b3f10]
- Updated dependencies [5df8e3a]
- Updated dependencies [22b7f6e]
- Updated dependencies [7053800]
  - @cosmicdrift/kumiko-bundled-features@0.366.0
  - @cosmicdrift/kumiko-framework@0.366.0
  - @cosmicdrift/kumiko-types@0.366.0
  - @cosmicdrift/kumiko-renderer@0.366.0
  - @cosmicdrift/kumiko-renderer-puppeteer-client@0.366.0
  - @cosmicdrift/kumiko-renderer-web@0.366.0
  - @cosmicdrift/kumiko-headless@0.366.0

## 0.365.1

### Patch Changes

- Updated dependencies [93e1a7d]
- Updated dependencies [9a8abc9]
- Updated dependencies [34530bf]
- Updated dependencies [8633239]
- Updated dependencies [34530bf]
- Updated dependencies [34530bf]
  - @cosmicdrift/kumiko-framework@0.365.1
  - @cosmicdrift/kumiko-bundled-features@0.365.1
  - @cosmicdrift/kumiko-types@0.365.1
  - @cosmicdrift/kumiko-headless@0.365.1
  - @cosmicdrift/kumiko-renderer@0.365.1
  - @cosmicdrift/kumiko-renderer-puppeteer-client@0.365.1
  - @cosmicdrift/kumiko-renderer-web@0.365.1

## 0.365.0

### Patch Changes

- 45abe9d: The document designer names seeded mails, opens in the UI language and shows the built-in layout
  
  <!-- kumiko-changes
  feature: document-designer
  type: improvement
  title: Seeded mails show readable titles and the editor opens in the UI language
  detail: A mail template without a stored title is named by its notification label (<feature>:notify.<name>.label) in the overview and the editor header instead of its slug. The mail editor opens on the UI language, or its base language, when the template has it, and falls back to the previous choice otherwise. The layout select offers the built-in standard layout when no default layout is stored, and the preview text field shows a hint while empty.
  -->
  
  <!-- kumiko-changes
  feature: auth-email-password
  type: improvement
  title: Auth mails carry designer labels
  detail: The feature registers <feature>:feature.label and notify labels for password-reset, account-unlock, email-verification, signup-activation and invite, so the document designer lists them by name. German and Spanish ship in the locale packages.
  -->
  
  <!-- kumiko-changes
  feature: user-data-rights
  type: improvement
  title: GDPR mails carry designer labels
  detail: Feature and notify labels for export-ready, export-failed, deletion-requested and deletion-executed name the GDPR mails in the document designer.
  -->
  
  <!-- kumiko-changes
  feature: billing-foundation
  type: improvement
  title: Contract mails carry designer labels
  detail: Feature and notify labels for contract-confirmation, contract-termination-receipt and contract-termination-operator-notice name the contract mails in the document designer.
  -->
  
  <!-- kumiko-changes
  feature: waitlist
  type: improvement
  title: Waitlist mails carry designer labels
  detail: Feature and notify labels for confirmation and admin-notice name the waitlist mails in the document designer.
  -->
- 72a5c9c: Document editors report null to onEditorReady when they are destroyed
  
  <!-- kumiko-changes
  feature: template-resolver
  type: breaking
  title: onEditorReady receives null when the editor is destroyed
  detail: DocumentTiptapEditor and PlaceholderLineEditor call onEditorReady(null) on destroy, so a held handle no longer points at a destroyed editor. The callback type is (handle: DocumentEditorHandle | null) => void. The document designer drops the handle of an unmounted field, so placeholder insertion no longer targets a destroyed editor.
  migration: A custom onEditorReady callback must accept null and drop its stored handle when it receives it.
  -->
- 6070813: Layout editor no longer asks for the platform override counts after a tenant save
  
  <!-- kumiko-changes
  feature: document-designer
  type: fix
  title: Layout editor no longer asks for the platform override counts after a tenant save
  detail: Saving or resetting a layout as tenant admin refetched the tenant-overrides query, which only the platform admin may read, so every save logged a 403. The reload now refetches it only for the platform admin.
  -->
- 45abe9d: Structured mails render as a card with a brand row, a toned chip and top line, a steps block and a footer band
  
  <!-- kumiko-changes
  feature: renderer-mail-html
  type: improvement
  title: Structured mail layouts render as a card with a footer band
  detail: The structured frame now draws a rounded white card with a border on the outer background. The top line sits inside the card, the footer region goes into a grey band at the bottom of the card, and the platform line from the footer resolver sits below the card. The in-code layout uses 640 px width and #ecedea as outer background and shows the tenant logo at 28 px height beside the tenant name, or an initial tile in the accent colour when no logo is set. Mail headings carry inline sizes (h1 30 px bold) and small text renders at 13 px. Existing structured layouts change their look accordingly; mjml layouts are unchanged.
  -->
  
  <!-- kumiko-changes
  feature: renderer-mail-html
  type: improvement
  title: Mail meta headerChip, tone and footerNote
  detail: A mail template can set meta.headerChip (a chip right of the brand row), meta.tone (accent, info, success, warning, danger or neutral; colours the chip, the top line of the card and the steps block) and meta.footerNote (a line above the site and unsubscribe links in the card band). All three accept placeholders and are rendered escaped; an unknown tone falls back to the accent colour. The band links the tenant site from the branding siteUrl next to the unsubscribe link. createRendererMailHtmlFeature({ brandSuffix }) adds a word after the tenant name in the brand row.
  -->
  
  <!-- kumiko-changes
  feature: template-resolver
  type: improvement
  title: Steps block in mail and PDF templates
  detail: The document editor offers a steps block in the toolbar block menu. It stores a fixed list of stages (value=label, at most 8) and the variable that names the current stage. Mail and PDF render it as a row of bars and labels; stages up to the current one are coloured, the current label is bold. Invalid blocks are dropped by the sanitizer and render nothing. Layout regions do not offer the block.
  -->
  
  <!-- kumiko-changes
  feature: dev-server
  type: improvement
  title: composeRendererStack passes a mail brand suffix resolver
  detail: composeRendererStack({ mailBrandSuffix }) hands the resolver to createRendererMailHtmlFeature as brandSuffix.
  -->
  
  <!-- kumiko-changes
  feature: document-designer
  type: improvement
  title: Mail editor rail edits header chip, tone and footer note
  detail: The properties rail of the mail editor has a section "Kopf und Fuß" with the header chip and the footer note as placeholder lines and the tone as a select (accent, info, success, warning, danger, neutral). The values are saved in the mail meta and show in the preview right away. A tone stored as placeholder stays as its own option; the accent tone is stored as no tone. template-resolver/web exports MAIL_TONES and MailTone.
  -->
  
  <!-- kumiko-changes
  feature: renderer-puppeteer-client
  type: improvement
  title: PDF steps block uses the branding accent colour
  detail: The steps block in a PDF document is coloured with the accent colour from the tenant branding, like in mails, and falls back to #1f5468 when no branding colour is set.
  -->
- b6b75fa: Layout validation waits for a pause in typing, quick mail uploads get distinct keys, and a failed system publish still reloads the editor
  
  <!-- kumiko-changes
  feature: document-designer
  type: fix
  title: Debounced layout validation, collision-free resource keys and reload after a half-finished system publish
  detail: The layout editor sent a validate query (with an MJML compile) on every change; it now waits 400 ms after the last edit. A second upload with the same file name before the row refetch finished reused the first key; keys handed out earlier are now remembered. When a SystemAdmin saved a mail version but publishing it failed, the editor kept the old state with the error shown; it now reloads so the stored version is visible.
  -->
- Updated dependencies [eef5ff1]
- Updated dependencies [84d7f1a]
- Updated dependencies [84d7f1a]
- Updated dependencies [eef5ff1]
- Updated dependencies [cd16f29]
- Updated dependencies [84d7f1a]
- Updated dependencies [72a5c9c]
- Updated dependencies [72a5c9c]
- Updated dependencies [7aa3223]
- Updated dependencies [eef5ff1]
- Updated dependencies [84d7f1a]
- Updated dependencies [84d7f1a]
- Updated dependencies [efa6253]
- Updated dependencies [84d7f1a]
- Updated dependencies [7e1b974]
- Updated dependencies [e4ecaba]
- Updated dependencies [ec7d696]
- Updated dependencies [efa6253]
- Updated dependencies [84d7f1a]
- Updated dependencies [eef5ff1]
- Updated dependencies [efa6253]
- Updated dependencies [45abe9d]
- Updated dependencies [72a5c9c]
- Updated dependencies [72a5c9c]
- Updated dependencies [81169ec]
- Updated dependencies [84d7f1a]
- Updated dependencies [efa6253]
- Updated dependencies [fbc6938]
- Updated dependencies [5a1cdc1]
- Updated dependencies [efa6253]
- Updated dependencies [eef5ff1]
- Updated dependencies [80e2132]
- Updated dependencies [72a5c9c]
- Updated dependencies [82dc9a4]
- Updated dependencies [82dc9a4]
- Updated dependencies [eef5ff1]
- Updated dependencies [eef5ff1]
- Updated dependencies [82dc9a4]
- Updated dependencies [eef5ff1]
- Updated dependencies [82dc9a4]
- Updated dependencies [eef5ff1]
- Updated dependencies [eef5ff1]
- Updated dependencies [2a33c8d]
- Updated dependencies [eef5ff1]
- Updated dependencies [eef5ff1]
- Updated dependencies [efa6253]
- Updated dependencies [59bbd15]
- Updated dependencies [72a5c9c]
- Updated dependencies [efa6253]
- Updated dependencies [84d7f1a]
- Updated dependencies [efa6253]
- Updated dependencies [45abe9d]
- Updated dependencies [45abe9d]
- Updated dependencies [5e5d83b]
- Updated dependencies [72a5c9c]
- Updated dependencies [72a5c9c]
- Updated dependencies [a546703]
- Updated dependencies [84d7f1a]
- Updated dependencies [72a5c9c]
- Updated dependencies [72a5c9c]
- Updated dependencies [efa6253]
- Updated dependencies [5c276e6]
- Updated dependencies [21c5cbc]
- Updated dependencies [82dc9a4]
- Updated dependencies [fbc6938]
- Updated dependencies [efa6253]
- Updated dependencies [72a5c9c]
- Updated dependencies [efa6253]
- Updated dependencies [b6b75fa]
- Updated dependencies [b6b75fa]
- Updated dependencies [b6b75fa]
- Updated dependencies [b6b75fa]
- Updated dependencies [72a5c9c]
- Updated dependencies [0f8bff5]
- Updated dependencies [84d7f1a]
- Updated dependencies [067aa7b]
- Updated dependencies [fbc6938]
- Updated dependencies [efa6253]
- Updated dependencies [efa6253]
- Updated dependencies [eef5ff1]
- Updated dependencies [84d7f1a]
- Updated dependencies [84d7f1a]
- Updated dependencies [cd16f29]
- Updated dependencies [72a5c9c]
- Updated dependencies [2a33c8d]
- Updated dependencies [eef5ff1]
- Updated dependencies [72a5c9c]
- Updated dependencies [efa6253]
- Updated dependencies [84d7f1a]
- Updated dependencies [82dc9a4]
- Updated dependencies [eef5ff1]
- Updated dependencies [82dc9a4]
- Updated dependencies [72a5c9c]
  - @cosmicdrift/kumiko-bundled-features@0.365.0
  - @cosmicdrift/kumiko-framework@0.365.0
  - @cosmicdrift/kumiko-types@0.365.0
  - @cosmicdrift/kumiko-renderer@0.365.0
  - @cosmicdrift/kumiko-renderer-puppeteer-client@0.365.0
  - @cosmicdrift/kumiko-renderer-web@0.365.0
  - @cosmicdrift/kumiko-headless@0.365.0

## 0.364.0

### Minor Changes

- 68078ee: Editors and overview show an open draft beside the active version
  
  The editor header shows the served version (Active vN) next to the open draft (Draft vM), fed by the active field of find-by-id and layout-source; the template overview shows the draftVersion badge under the status of an active row.
  
  <!-- kumiko-changes
  feature: document-designer
  type: improvement
  title: Editors and overview show an open draft beside the active version
  -->
- c181b3f: Document designer editors follow the approved board
  
  Mail-layout templates accept appearance meta (width, font, outer background, accent line, button style) that the mail renderer applies, and the layout-source query returns it. The layout editor uses the shared editor shell with one paper and one shared toolbar (`DocumentContentEditor` gains `toolbarHost`). Mail and PDF editors share frame, info bar, rails and footer.
  
  The unused `sender` key of mail template meta is gone from the editor; stored rows that still carry it are read without it, so they stay editable.
  
  Invalid template meta now reports per-field messages (`templateResolver.errors.template.meta.<field>.required|invalid`) instead of the parser text; the editors show them at the field. The `tenant-overrides` query additionally returns one row per customising tenant (name, status, version, changed at/by) and, with `diffTenantId`, the diff to the system version. A language without a version shows an empty state in the mail editor instead of a disabled editor.
  
  The `compileDocumentBody` option `resourceImageMaxWidthPx` caps resource images in mails (180 px). The `send-test` command takes `prefixSubject` (default true) to skip the `[TEST]` subject prefix, the template preview returns `mailLayout` (slug, scope, version of the layout used), and `RenderedMail` carries the layout ref.
  
  <!-- kumiko-changes
  feature: document-designer
  type: improvement
  title: Document designer editors follow the approved board
  -->

### Patch Changes

- 8e81d73: PDF editor saves only the margins that are set; preview and error handling fixes
  
  <!-- kumiko-changes
  feature: document-designer
  type: fix
  title: PDF editor keeps unset margins unset, frees old PDF previews, and shows reset and diff errors
  detail: Setting one margin no longer stores the other three as 15 mm, so the layout's header and footer margins still apply to them. The PDF preview no longer re-renders pages or stacks text layers on re-render and destroys the previous document. A failed reset to the system version shows an error banner in the PDF and mail editors, and a failing diff query shows an error state with retry instead of loading forever. The canvas reserves the footer margin like the renderer. Page formats, orientations and default margins now come from template-resolver (new exports PDF_ORIENTATIONS, PDF_DEFAULT_MARGIN_MM, PDF_HEADER_MARGIN_MM, PDF_FOOTER_MARGIN_MM, PdfOrientation).
  -->
- 15039ce: The layout editor counts the users of a layout on the server instead of from a page of 200 templates
  
  <!-- kumiko-changes
  feature: template-resolver
  type: fix
  title: template-resolver:query:overview accepts layoutSlug to list only the mails and PDFs using that layout
  detail: The optional layoutSlug payload field keeps only documents whose layout slug matches; total counts the filtered rows. Without it the response is unchanged.
  -->
  
  <!-- kumiko-changes
  feature: document-designer
  type: fix
  title: Layout editor shows the real number of mails or PDFs using a layout
  detail: The editor asks the overview for the users of one layout (kind and layoutSlug filter) and takes the count from total, so a tenant with more than 200 templates no longer sees a too low usage number.
  -->
- 55f003d: Test isolation for the search payload warn spy and the mail editor placeholder rail
  
  <!-- kumiko-changes
  feature: framework
  type: fix
  title: Unit tests no longer leak a console.warn spy into later files
  detail: The search payload precedence tests spy on console.warn per test and restore it, so later files in the same --no-isolate worker start with the real console.warn. The mail editor missing-language test waits for the placeholder rail instead of reading it before the validate query settled.
  -->
- Updated dependencies [15039ce]
- Updated dependencies [8e81d73]
- Updated dependencies [a0dcd31]
- Updated dependencies [fd5009a]
- Updated dependencies [8e81d73]
- Updated dependencies [e9b032f]
- Updated dependencies [15039ce]
- Updated dependencies [cfbffba]
- Updated dependencies [15039ce]
- Updated dependencies [8e81d73]
- Updated dependencies [6b1567e]
- Updated dependencies [2b255c2]
- Updated dependencies [15039ce]
- Updated dependencies [8e81d73]
- Updated dependencies [92a9c52]
- Updated dependencies [fd5009a]
- Updated dependencies [8be3807]
- Updated dependencies [15039ce]
- Updated dependencies [8e81d73]
- Updated dependencies [c181b3f]
- Updated dependencies [8e81d73]
- Updated dependencies [fd5009a]
- Updated dependencies [8e81d73]
- Updated dependencies [8e81d73]
- Updated dependencies [8e81d73]
- Updated dependencies [15039ce]
- Updated dependencies [fd5009a]
- Updated dependencies [fd5009a]
- Updated dependencies [8e81d73]
- Updated dependencies [fd5009a]
- Updated dependencies [15039ce]
- Updated dependencies [8e81d73]
- Updated dependencies [8e81d73]
- Updated dependencies [8e81d73]
- Updated dependencies [b13c0d4]
- Updated dependencies [fd5009a]
- Updated dependencies [dfb2523]
- Updated dependencies [8fb6aa6]
- Updated dependencies [7482ee2]
- Updated dependencies [8e81d73]
- Updated dependencies [8e81d73]
- Updated dependencies [fd5009a]
- Updated dependencies [5a39305]
- Updated dependencies [8e81d73]
- Updated dependencies [8e81d73]
- Updated dependencies [fd5009a]
- Updated dependencies [7482ee2]
- Updated dependencies [f1b4367]
- Updated dependencies [fd5009a]
- Updated dependencies [15039ce]
- Updated dependencies [15039ce]
- Updated dependencies [15039ce]
- Updated dependencies [15039ce]
- Updated dependencies [e9b032f]
- Updated dependencies [15039ce]
- Updated dependencies [8be3807]
- Updated dependencies [22f40e1]
- Updated dependencies [5a2bea5]
- Updated dependencies [7482ee2]
- Updated dependencies [7482ee2]
- Updated dependencies [7482ee2]
- Updated dependencies [7482ee2]
- Updated dependencies [7482ee2]
- Updated dependencies [7482ee2]
- Updated dependencies [7482ee2]
- Updated dependencies [7482ee2]
- Updated dependencies [7482ee2]
- Updated dependencies [7482ee2]
- Updated dependencies [7482ee2]
- Updated dependencies [7482ee2]
- Updated dependencies [8e81d73]
- Updated dependencies [baf641a]
- Updated dependencies [8e81d73]
- Updated dependencies [92a9c52]
- Updated dependencies [15039ce]
- Updated dependencies [fd5009a]
- Updated dependencies [8e81d73]
- Updated dependencies [8be3807]
- Updated dependencies [8e81d73]
- Updated dependencies [15039ce]
- Updated dependencies [68078ee]
- Updated dependencies [15039ce]
- Updated dependencies [15039ce]
- Updated dependencies [b5a6395]
- Updated dependencies [fd5009a]
- Updated dependencies [55f003d]
- Updated dependencies [8e81d73]
- Updated dependencies [fd5009a]
- Updated dependencies [8e81d73]
- Updated dependencies [8e81d73]
  - @cosmicdrift/kumiko-bundled-features@0.364.0
  - @cosmicdrift/kumiko-framework@0.364.0
  - @cosmicdrift/kumiko-types@0.364.0
  - @cosmicdrift/kumiko-renderer-puppeteer-client@0.364.0
  - @cosmicdrift/kumiko-renderer@0.364.0
  - @cosmicdrift/kumiko-renderer-web@0.364.0
  - @cosmicdrift/kumiko-headless@0.364.0

## 0.363.0

### Minor Changes

- f16183c: Mail editor screen with live preview and test mail

  <!-- kumiko-changes
  feature: document-designer
  type: improvement
  title: Mail templates open in a mail editor with preview and test mail
  detail: The "Edit" row action of a mail template opens the new mail-editor screen: subject, preview text and content with placeholders from the notification, logo and file attachments, PDF-template attachments, layout and category, sandboxed preview (HTML or text, desktop or 375 px), test mail to the signed-in user and the audit-based version list. PreviewRecordPickerProvider is an optional slot for a "pick a record" action in the preview.
  -->

- 3c6b3da: Template overview and layout editor

  <!-- kumiko-changes
  feature: template-resolver
  type: improvement
  title: Overview and layout-source queries for the template designer
  detail: template-resolver:query:overview lists the mail, PDF and layout templates of the caller's tenant grouped by slug and kind (effective origin, locales, status, versions, layout slug, last change and the notifications that use it) and template-resolver:query:layout-source returns the header, signature and footer regions of a mail or PDF layout plus the locale a save has to use; a SystemAdmin also receives the MJML source of the system layout. The usage lookup is the exported collectTemplateUsage.
  -->

  <!-- kumiko-changes
  feature: managed-pages
  type: improvement
  title: Branding screen edits the logo file and readBranding returns logoFile
  detail: The branding settings screen has a logo upload for managed-pages:config:branding-logo-file, and readBranding and the branding query include logoFile next to logoUrl. The template resource errors template_resource_too_large and template_resource_unsupported_image have German and Spanish texts.
  -->

  <!-- kumiko-changes
  feature: admin-shell
  type: improvement
  title: includeDocumentDesigner lists the template navs in the admin workspaces
  detail: With includeDocumentDesigner, the tenant workspace shows document-designer:nav:templates and the platform workspace document-designer:nav:platform-templates. The option requires the document-designer feature and defaults to false.
  -->

  <!-- kumiko-changes
  feature: document-designer
  type: improvement
  title: Template overview, layout editor and an options object for documentDesignerClient
  detail: The package gains the server feature createDocumentDesignerFeature with the templates and platform-templates overviews and the layout-editor screen. documentDesignerClient now takes an options object instead of a screen id, and appLocales sets the languages column of the overview. The feature declares the pdf-template-editor screen (PDF_TEMPLATE_EDITOR_SCREEN_ID) and PDF rows open the PDF editor.
  -->

- 0a79504: Add the PDF template editor screen (`@cosmicdrift/kumiko-document-designer/web`): placeholder panel, page canvas with layout header and footer, page settings, validation footer and a pdf.js preview. The template-resolver document editor gains an `align` block, labelled placeholder chips, a repeat-table bar and an `onEditorReady` handle; `template-resolver/web` exports the qualified names; `renderer-puppeteer-client` exports `./qualified-names`; renderer-web's stylesheet scans the new package.

  <!-- kumiko-changes
  feature: document-designer
  type: improvement
  title: New package with the PDF template editor screen
  detail: "@cosmicdrift/kumiko-document-designer/web" exports documentDesignerClient(screenId), PdfTemplateEditorScreen, PdfTemplateEditor and documentDesignerTranslations. The screen takes the template from the URL (?slug=...&locale=...), edits the system template for a SystemAdmin and a tenant customisation for everyone else, and previews the printed PDF with pdf.js. template-resolver/web additionally exports DocumentEditorHandle, TemplateResolverQueries, TemplateResolverHandlers and TemplateResolverErrors.
  -->

  <!-- kumiko-changes
  feature: renderer-web
  type: improvement
  title: uploadFileRef uploads a file to the stack and returns its FileRef id
  detail: uploadFileRef(file, target?) posts to /api/files with the CSRF header and returns the new FileRef id; it throws FileUploadFailedError carrying the server message when the endpoint sent one. FileUploadInput uses it with unchanged behaviour.
  -->

### Patch Changes

- Updated dependencies [9120f65]
- Updated dependencies [ef689d8]
- Updated dependencies [9120f65]
- Updated dependencies [045f886]
- Updated dependencies [a12e094]
- Updated dependencies [9120f65]
- Updated dependencies [b9a146d]
- Updated dependencies [9120f65]
- Updated dependencies [58452ae]
- Updated dependencies [ef689d8]
- Updated dependencies [a12e094]
- Updated dependencies [3c6b3da]
- Updated dependencies [09a4aa2]
- Updated dependencies [b022cca]
- Updated dependencies [fcd6eb4]
- Updated dependencies [2972bc2]
- Updated dependencies [2972bc2]
- Updated dependencies [2972bc2]
- Updated dependencies [ef689d8]
- Updated dependencies [4a748c3]
- Updated dependencies [0a79504]
- Updated dependencies [0a79504]
- Updated dependencies [2972bc2]
- Updated dependencies [f7da271]
- Updated dependencies [9120f65]
- Updated dependencies [7ed530a]
- Updated dependencies [d35e9a0]
- Updated dependencies [549a6f6]
- Updated dependencies [f3fe91e]
- Updated dependencies [3c6b3da]
- Updated dependencies [2972bc2]
- Updated dependencies [3c6b3da]
- Updated dependencies [46b83b8]
- Updated dependencies [cbed66e]
- Updated dependencies [366d89f]
- Updated dependencies [a12e094]
- Updated dependencies [9120f65]
- Updated dependencies [9120f65]
  - @cosmicdrift/kumiko-bundled-features@0.363.0
  - @cosmicdrift/kumiko-framework@0.363.0
  - @cosmicdrift/kumiko-types@0.363.0
  - @cosmicdrift/kumiko-renderer-web@0.363.0
  - @cosmicdrift/kumiko-renderer-puppeteer-client@0.363.0
  - @cosmicdrift/kumiko-renderer@0.363.0
  - @cosmicdrift/kumiko-headless@0.363.0
