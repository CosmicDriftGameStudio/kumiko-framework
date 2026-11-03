---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-types": patch
---

Review round 3 for cli and renderer: remembered list params no longer cost a default query, existing files in a dropzone show their file name, long id lists in named filters stay below the Postgres bind limit, the editor rails keep a sensible focus order, and the minor-unit scale lives in one place.

<!-- kumiko-changes
feature: renderer
type: fix
title: lists hold their queries while remembered params are restored
detail: With `rememberState`, a list opened without URL params fetched once with the defaults (rows, groups, totals) before the stored params reached the URL, and showed the unfiltered list for a moment. `useRememberedListParams` now returns `restoring`, and the row and aggregate queries wait until the restored URL arrived. A file dropzone shows the file name of a value the form already held (resolved through the file meta cache) instead of the FileRef id, via the new `UploadZone` prop `labelForValue`. Clearing a stored money amount in an edit form is no longer stripped silently from the submit; the server answers it visibly. The three-column editor body keeps the DOM order left rail, page, right rail and places the rails by grid.
-->

<!-- kumiko-changes
feature: framework
type: fix
title: named filter id lists bind as one array parameter
detail: A list filter with `op: "in"` on a plain column bound one placeholder per value, so an id list from an async named-filter resolver failed beyond 65535 values and bloated the SQL text. It now binds one typed array parameter (`col = ANY($n::type[])`). `MINOR_UNIT_SCALE`, `toMinorUnits` and `toMajorUnits` moved to `@cosmicdrift/kumiko-types/minor-units`; the renderer's range facets and money measures use them instead of their own `100`. Comments that pointed at deleted names (`OVERRIDABLE_PROFILE_KEYS`, `buildErrorLog`, `SelectQuery`) are corrected. `kumiko status` exits non-zero when `git status` fails, and the CI puppeteer cache key step fails on a version that is not pinned exactly.
-->
