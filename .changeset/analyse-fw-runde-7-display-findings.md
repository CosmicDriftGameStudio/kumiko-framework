---
"@cosmicdrift/kumiko-types": patch
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-locale-de": patch
"@cosmicdrift/kumiko-locale-es": patch
"@cosmicdrift/kumiko-locale-fr": patch
"@cosmicdrift/kumiko-locale-it": patch
"@cosmicdrift/kumiko-samples": patch
---

Display fixes found on app screenshots: phone cards, tabs, nav labels, result tables, month values and file links.

<!-- kumiko-changes
feature: renderer
type: fix
title: Active tab stays visible when the tab bar grows
detail: When tab counts load later and the tab bar gets wider, the active tab is scrolled back into view on every size change, not only when the tab changes.
-->

<!-- kumiko-changes
feature: framework
type: fix
title: A column hidden on phones no longer becomes the card badge
detail: `cardColumnRoles` skips `hideOnNarrow` select columns in the status fallback, as it already did for `cardBadge` columns.
-->

<!-- kumiko-changes
feature: bundled-features
type: fix
title: Shorter nav labels, translated content folders and layout presets
detail: The all-tenants audit log nav label is shorter in every locale so it fits the sidebar. The template-resolver content tree labels its folders and its root through `template-resolver.folder.<segment>` and `template-resolver.nav.content`; a `TreeNode` can carry a `labelKey` that the nav tree translates, falling back to the raw label; the sidebar search matches the translated label. The branding layout preset select shows translated option labels. All texts ship in English, German, Spanish, French and Italian.
-->

<!-- kumiko-changes
feature: renderer
type: fix
title: Result tables keep the data table cell padding
detail: `ResultTable` and `ComparisonTable` without `card` pad their cells with `px-2` like `DataTable`, so neighbouring columns no longer run together.
-->

<!-- kumiko-changes
feature: renderer
type: improvement
title: Month format for year-month text
detail: The new cell format `{ format: "month" }` shows a `YYYY-MM` value as month and year in the user's locale ("June 2026"). An entityList text field declared with `format: "month"` uses it by default; other values stay as they are. The list-table-options recipe shows it.
-->

<!-- kumiko-changes
feature: renderer
type: improvement
title: File links in lists read as downloads
detail: A file cell in a list shows a download icon before the file name and is labelled "Download: <name>" (`kumiko.field.file-list.downloadNamed`, in all locale packages).
-->

<!-- kumiko-changes
feature: framework
type: improvement
title: Boot warning for a file column a phone cannot reach
detail: Boot warns with `list/hidden-file-column` when an entityList hides a file column on narrow screens (`hideOnNarrow`) and its rows open nothing that shows the file: no rowClick action, no `detailFor` screen and no entityEdit screen for the entity with that field in its layout. A single reference column counts too when its target entity has exactly one file field, since its cell links that file; an edit screen does not make it reachable, because its form shows the reference picker. The relatedList sections of projectionDetail and entityEdit screens are checked as well, where only the section `rowClick` or a rowClick action opens a row. An app-wide `createKumikoApp({ onRowClick })` is client code the boot cannot see. It is a warning, so existing apps keep booting.
-->

<!-- kumiko-changes
feature: renderer
type: fix
title: Phone card layout: title first, date ranges, no empty lines
detail: On the phone card the title keeps its line and a long status badge wraps below it. Exactly two unlabelled dates on one line above the title (`cardAbove`) read as a range with a dash. Empty file lists no longer leave a blank meta line. With a row menu (and no leading image, checkbox or expand toggle) the menu sits beside the title line without making it taller, the status badge stays at the right edge, and the lines above and below the title use the full card width.
-->

<!-- kumiko-changes
feature: renderer
type: fix
title: Progress lists name an entry above its bar, translated notification region
detail: `ProgressList` shows name and value first and the bar right below, with more space between two entries than inside one, so a reader from the top pairs each name with its own bar. The toast region is labelled through `kumiko.toast.viewport-label` (Radix fills in the hotkey) instead of the fixed English "Notifications (F8)", in all locale packages.
-->

<!-- kumiko-changes
feature: renderer
type: improvement
title: A reference to a record with one file links that file
detail: A list cell of a single reference (`createReferenceField` or a column with `refEntity`) whose target entity has exactly one `file` field and no `files` field shows the reference label as a download link to that file, with the PDF view in a drawer like the file column of the documents list. The file link takes the place of the link to the referenced record. The file id comes from the rows of the reference lookup query, so tenant and field read access apply: an unreadable file field, an unreadable target or an empty file keep the plain label. The name shown is the reference label, never the stored file name. A target with several file fields, a `files` field, a multi reference or an author renderer stays text, and so do reference columns of dashboard list panels. The documents recipe shows it with an offer that references a filed document.
-->
