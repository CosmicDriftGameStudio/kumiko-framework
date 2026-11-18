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

<!-- kumiko-changes
feature: renderer
type: fix
title: The comma between phone card values stays at the value before it
detail: In plain phone cards (`plainPhoneCards`, related lists) two `narrowInline` values on one line are joined by a comma that now sits in the same item as the front value, and the space after it is the line's column gap. An app stylesheet that widens that gap no longer leaves the comma standing alone with space on both sides ("980,00 €  ,  29.10.2026" becomes "980,00 €, 29.10.2026"). The front value takes its line height from that item, so an app rule on the line's direct children (`[data-testid^="card-vals-"] > div`) still reaches both values. A date range above the title keeps its dash flush between the dates.
-->

<!-- kumiko-changes
feature: renderer
type: fix
title: Related lists sort money, located times and empty values like the standalone list
detail: A relatedList sorts its loaded rows in the client. A money column (`{ amount, currency }`) now orders by its amount, like the server's column sort, which ignores the currency; before, every money value compared equal and the rows kept the server's id order. A `locatedTimestamp` column orders by its instant, and timestamps within one second order by their fraction whatever its digit count. Empty values sit where the standalone list puts them: last ascending, first descending, or where the field's `sortNulls` says. Rows with the same value follow the id, the standalone list's second key. `sortByAccessor` takes optional `nullsFirst` and `tieBreaker`; without them it behaves as before.
-->

<!-- kumiko-changes
feature: renderer
type: fix
title: Related lists let their query sort, so the first page holds the right rows
detail: buildAppSchema derives `serverSortFields` on every relatedList section and entityList `expandableRow` from the bound query: nothing without a `sort` param, the enum literals of a hand-written query, the fields the SQL sort of an `<entity>:list` query orders by for every caller (no locatedTimestamp, no encrypted field, no field or reference label with its own `access.read`, a reference only with `sortable: true` and a label), plus `insertedAt` where the query can order by it. An open `sort: z.string()` is trusted for the sortable columns, except a reference of the section's `entity` without such a label sort. A value written by the app is overwritten. The section sends `sort`/`sortDirection` for a `defaultSort` or header click on such a column and reloads, so a section with more rows than `pageSize` shows the smallest or largest values instead of sorting only the loaded page. Text columns sorted this way follow the database collation, like the standalone list, instead of the client's locale collation (numeric, case-insensitive): "W 10" now sorts before "W 2". Without a sort it asks for `insertedAt` ascending, so child rows with random (v4) ids come in creation order across commands; rows written in one transaction share `insertedAt` and keep id order among themselves. A column the query cannot order keeps the client sort over the loaded rows; a reference column the query cannot order by its label offers no sort at all, since the client only has its uuid. Apps that marked such a reference `sortable` in the section lose that header sort until the entity field gets `sortable: true` and a `labelField`.
-->

<!-- kumiko-changes
feature: framework
type: fix
title: pageRows orders empty values and instants like the SQL list
detail: `pageRows` puts missing values last ascending and first descending, like the server list (`nullsSortFirst`), and compares ISO instant strings by time whatever their fraction digit count (`instantSortKey`, now exported from `ui-types` and shared with the relatedList client sort). Lists that page through `pageRows` and sort descending by a nullable column now show the empty rows first: publicstatus sysadmin users (`globalRoles`, `locale`) and tenants (`customDomain`), and the bundled tenant-caps and readiness-run lists.
-->

<!-- kumiko-changes
feature: framework
type: fix
title: Sorting and filtering by a companion column respect the field's read access
detail: Money, located timestamps and lookupable text store companion columns (`<name>Currency`, `<name>Utc`, `<name>Tz`, `<name>Bidx`) that have no field entry of their own. A list `sort` or `filter` on such a column skipped the field-level read check, so a caller who could not read the field could learn its order, or which rows share a value, through it. These columns now carry the read rule of their field: the sort drops to id order, the filter matches nothing, as for the field itself.
-->
