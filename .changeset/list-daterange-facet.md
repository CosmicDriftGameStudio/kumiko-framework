---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-renderer-web": minor
"@cosmicdrift/kumiko-bundled-features": minor
---

A projectionList can declare a time-range filter

A list bound to a query that already accepts time bounds had no way to expose them: `ListFacetSpec` knew `select`, `boolean` and `reference`, so every list with a timestamp — which, through `createdAt`, is practically every list — could be searched but not narrowed to "the week the incident happened". The audit log shipped a `description` promising date filters that no control backed.

`{ type: "dateRange", field, label, params: { from, to } }` closes that. The renderer maps it to two native `<input type="date">` next to the facet dropdowns (no date dependency; the browser supplies the calendar, the locale and the keyboard handling) and sends the picked bounds as the two query params the facet names — explicit rather than a `from`/`to` convention, since a query is free to call them anything, and checked against the handler's Zod schema at boot. Filtering stays server-side; either bound alone is a valid open interval; changing the range resets the page like every other facet; an inverted range is clamped in the UI instead of reaching the handler's `from <= to` refine.

A calendar date covers a whole day in the viewer's time zone: "to the 14th" includes everything through the last instant of the 14th, computed across DST boundaries rather than by adding 24 hours. `audit:screen:audit-log` now declares the facet on `createdAt`, so its description holds.

<!-- kumiko-changes
feature: framework
type: improvement
title: A projectionList can declare a time-range filter
-->
