---
"@cosmicdrift/kumiko-framework": patch
---

Boot validator follow-ups.

- A `dateRange` facet param name used by more than one dateRange facet on a projectionList screen now fails boot (the facets overwrote each other's bound).
- `header.subtitleHref` and a section's `countField` on a projectionDetail screen are checked against the query's `outputSchema`.
- `redirect.idFrom` with leading or trailing whitespace now fails boot instead of silently navigating without an id.
- A `refEntity` pointing at a feature that is not mounted now says so and names `r.requires(...)` instead of listing "(none)" entities.
- The nav inversion warning no longer prints `requires roles []` for a leaf with an invalid `openToAll`, and the unreachable-screen warning points workspace apps at `r.workspace({ nav })` instead of a non-existent allowlist.
- The where-rule boot probe renders `ctx.tableName` with the real table name, matching runtime.

<!-- kumiko-changes
feature: framework
type: improvement
title: Boot validator rejects overlapping dateRange facet params, unknown subtitleHref/countField fields and whitespace in redirect.idFrom; clearer refEntity, nav and where-probe diagnostics
migration: |
  Boot now fails for configurations that silently misbehaved. Give each dateRange facet on a screen its own from/to params, point header.subtitleHref and section countField at fields of the query's outputSchema, and remove stray whitespace from redirect.idFrom.
-->
