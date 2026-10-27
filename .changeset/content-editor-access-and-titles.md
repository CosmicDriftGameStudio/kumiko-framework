---
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-testing": patch
"@cosmicdrift/kumiko-locale-de": patch
"@cosmicdrift/kumiko-locale-es": patch
"@cosmicdrift/kumiko-locale-fr": patch
"@cosmicdrift/kumiko-locale-it": patch
---

Content collection trees and the text block editor follow the server's access rules, and an edit screen opened to create names itself accordingly.

<!-- kumiko-changes
feature: template-resolver
type: fix
title: collection trees and Save follow the server's access rules
detail: textBlocksClient({ tenantId }) no longer sends tenantIdOverride for `ownership: "user"` collections, and a tenant-wide tree that the server answers with tenant_override_requires_system_admin reloads on the session tenant, so members see and edit their own entries instead of an error. The Save button follows the collection's own access rule (DEFAULT_COLLECTION_ACCESS when none is declared), the same rule the list, item and set handlers check; the public text-block pair keeps TenantAdmin or SystemAdmin. A save reloads the tree of its collection, so a new per-user entry shows without a page reload. The editor sets the page header title to the entry title, so the breadcrumb no longer shows the screen behind it.
-->

<!-- kumiko-changes
feature: renderer
type: improvement
title: edit screens opened without a record use screen:<id>.createTitle
detail: When a detail screen is opened without an entity id and the feature translates `screen:<id>.createTitle`, the breadcrumb and page title use it instead of the edit title. managed-pages names its create state "New page".
-->

<!-- kumiko-changes
feature: framework
type: fix
title: compliance profile labels are English
detail: The labels of the built-in compliance profiles (eu-dsgvo, swiss-dsg, de-hr-dsgvo-hgb, minimal) were German in the English source; locale packages keep their option translations, and the compliance-profiles catalog now shows those translations instead of the raw source label. Authority names such as the de-hr authority contact stay as the authority calls itself.
-->

<!-- kumiko-changes
feature: testing
type: improvement
title: request-helper sessions carry a realistic IP and user agent
detail: Sessions the request helper opens record a documentation-range IP and a desktop Chrome user agent instead of "test" and "request-helper", so seeded sample apps show plausible rows on My sessions.
-->

<!-- kumiko-changes
feature: renderer
type: improvement
title: resizable tables size columns by content until the user resizes one
detail: With `table.resizing` on (also through `bundledLists`), columns without a schema `width` no longer start at a flat 160px. The table keeps the auto layout and sizes them by content until the user drags or arrow-keys a column; that first resize stores the displayed widths of the other columns too, so nothing jumps. The first column of a resizable table breaks only when the table runs out of width, and a clickable first cell wraps instead of truncating. `onWidthChange` gets an optional third argument with those widths. Stored widths from earlier sessions still apply. Apps with `bundledLists.table.resizing` (use-all-bundled, solon) see wider name columns and narrower leftover space on first visit.
-->
