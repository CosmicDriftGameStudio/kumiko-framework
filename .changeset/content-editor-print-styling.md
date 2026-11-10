---
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-document-designer": minor
"@cosmicdrift/kumiko-renderer-puppeteer-client": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-locale-de": minor
"@cosmicdrift/kumiko-locale-es": minor
"@cosmicdrift/kumiko-locale-fr": minor
"@cosmicdrift/kumiko-locale-it": minor
---

PDF templates get print styling in the content editor.

<!-- kumiko-changes
feature: template-resolver
type: improvement
title: Frames and text styles in PDF templates
detail: A PDF body can hold positioned frames (address window at DIN 5008 form B or A, free text frame, as `div[data-frame]` with `data-x`, `data-y`, `data-width`, `data-height` in mm) and text styles (`span[data-text-style]` with font, size in pt and colour, plus line height and paragraph spacing on blocks). Both go through the sanitizer and compile to inline CSS. The font catalog is Arial, Times New Roman, Courier New, Calibri and Cambria; the puppeteer-service image needs the metric-compatible fonts (Carlito, Caladea) next to the Liberation ones, so rebuild it.
-->

<!-- kumiko-changes
feature: template-resolver
type: breaking
title: signature and imprint are no longer placeholders, company* names are reserved
detail: In `document-pdf` and `pdf-layout` templates, `signature` and `imprint` are no longer placeholders; a template that uses them fails on save and publish. The ten `company*` names (`companyAddress`, `companyPhone`, `companyEmail`, `companyWebsite`, `companyRegister`, `companyVatId`, `companyManagement`, `companyBank`, `companyIban`, `companyBic`) are now reserved, so a notification variable with such a name fails at boot.
migration: Remove `signature` and `imprint` from PDF templates and layouts. Rename notification variables that collide with a reserved `company*` name.
-->

The PDF layout carries its own look.

<!-- kumiko-changes
feature: document-designer
type: improvement
title: Layout appearance, ruler and company data rail
detail: A PDF layout sets font, size, text colour, table style, table header colour and page margins in its `meta`. The editor paper shows them with a cm ruler and the margin zones; a template inherits the layout margins ("Aus Layout: ...") and can override them. Footer and header accept a columns block. The company data rail lists the tenant's company settings next to the placeholders and inserts them on click; a placeholder without a value is flagged by the validate query (`emptyCompanyData`). Company placeholder names (`companyAddress`, `companyIban`, ...) are reserved and cannot be declared as template variables.
-->

Header and footer print like the editor shows them.

<!-- kumiko-changes
feature: template-resolver
type: improvement
title: Header and footer use the layout font size
detail: PDF header and footer take the layout's `fontSizePt` and fall back to 10.5pt, the size the editor always showed; before they printed at 9px. Paragraphs in header and footer no longer carry margins. Existing PDF layouts therefore change on the next render: a footer taller than the bottom margin minus 4mm reaches into the page body, so check multi-line footers.
-->

A layout can be the tenant default or be applied to templates.

<!-- kumiko-changes
feature: template-resolver
type: improvement
title: Default PDF layout per tenant, apply-layout and publish-templates
detail: The tenant config key `template-resolver:config:default-pdf-layout-slug` picks the layout of PDF templates that name none. `template-resolver:write:apply-layout` sets it (mode `all`, no copies) or writes the layout into a tenant draft per chosen template (mode `selected`, text unchanged); `template-resolver:write:publish-templates` activates drafts together and reports per template what failed. The usage query lists the templates a layout serves, with `hasOwnLayout` for those that follow the default.
-->

PDF bodies follow a line grid and stay flush with the text margin.

<!-- kumiko-changes
feature: template-resolver
type: breaking
title: Line grid, flush tables and the address window in PDF bodies
detail: PDF bodies print at line height 1.2. Paragraphs, lists, headings and tables are spaced by one body line (`--doc-line`, font size times 1.2) instead of 6pt after a paragraph and browser heading margins; the last element in a cell, list item, frame or the document has no bottom margin. Tables are flush with the text margin: the outer cells lose their left and right padding unless the layout table style is `grid` or the header has a background. Address paragraphs start at the text margin, have no spacing between lines, and the sender line prints at 7pt and wraps instead of being cut off. Flow text below a frame that reserves space starts 8mm under it. In the editor, cells are top-aligned, header cells print like body text, and rules appear only where the layout table style prints them; an untouched layout shows the table style "plain", as the PDF always printed it; a dashed outline marks cells while editing. Frames snap to page margins and other frames while moving or resizing (hold Alt to move freely).
migration: Render existing PDF templates once and check the page breaks. A template that relied on the 6pt paragraph gap sets the spacing per paragraph instead.
-->

<!-- kumiko-changes
feature: framework
type: improvement
title: Modal size, labelled action menu and menu item descriptions
detail: `Modal` takes `size: "wide"` for content with lists beside actions. The action menu accepts `triggerLabel` for a labelled button instead of the three-dots icon, and a `MenuItemDef` can carry a `description` line and its own `testId`.
-->

<!-- kumiko-changes
feature: document-designer
type: improvement
title: PDF paper opens once its layout and placeholders are known
detail: The PDF template editor shows a loading state in the canvas until the first validate, preview and layout source answers are in, so the editor no longer rebuilds right after opening and drops the caret, and the text no longer shifts when the layout arrives. A tenant default layout that was archived or deleted falls back to the built-in letterhead in the PDF, the preview and the usage lists.
-->

<!-- kumiko-changes
feature: document-designer
type: breaking
title: The template title is a rich-text field in front of the body
detail: The title above the PDF template body is a contenteditable field now, so the first `[contenteditable]` of the editor is the title, not the body. While the editor loads, a read-only placeholder carries the body id `document-designer-content`.
migration: In e2e specs, target the body with `#document-designer-content[contenteditable="true"]` instead of the first `[contenteditable]` of the editor.
-->
