---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-locale-de": minor
"@cosmicdrift/kumiko-locale-es": minor
"@cosmicdrift/kumiko-locale-fr": minor
"@cosmicdrift/kumiko-locale-it": minor
---

Lists with `table.export` get an Export button that downloads the filtered list as an XLSX file.

<!-- kumiko-changes
feature: framework
type: improvement
title: XLSX export for entityList and projectionList via table.export
detail: The new table.export block ({ xlsx: true, maxRows? }) is validated at boot and is only accepted on entityList and projectionList. POST /api/export/xlsx runs the list query again with the caller's session, pages through the whole filtered list and answers 413 above maxRows (default 10000, hard cap 100000). Encrypted, sensitive, write-only and unreadable fields and virtual columns are left out of the sheet. Reference columns export the label of the target (joined with commas for multiple references), not the id. Timestamp cells use the browser time zone sent with the request, else the profile zone, else UTC. Personal access tokens are rejected. A projectionList query must honor offset or return nextCursor. Adds the write-excel-file dependency.
-->

<!-- kumiko-changes
feature: renderer
type: improvement
title: Export button in the DataTable toolbar
detail: Lists with table.export show an Export button next to the view menu. It exports the current search, sort and facets with the visible columns in their order and shows a hint when the list exceeds the row limit. New keys kumiko.list.export, kumiko.list.export-busy, kumiko.list.export-too-many and kumiko.list.export-failed in all locale packages.
-->
