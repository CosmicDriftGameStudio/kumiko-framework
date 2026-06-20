---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-renderer-web": minor
---

Add interactive faceted filters to the auto-generated entity list — the shadcn
data-table pattern (outline dropdown buttons with multi-select checkboxes, like
the "Columns" toggle). Each `filterable: true` **select** or **boolean** field
becomes a facet dropdown in the list toolbar; selecting values filters the list
server-side and a "Reset" clears all active facets.

Wiring across the layers:

- **Query schema** (`defineEntityListHandler`): a new `filters?: Filter[]`
  field next to the existing static `filter?` — additive, no contract break.
  `executor.list` applies the static filter and every dynamic filter with AND
  (the `op:"in"` array path already produced correct `IN (...)` SQL).
- **Client schema** (`buildAppSchema`): the field-level `filterable` flag is now
  serialized so the renderer knows which fields can be faceted.
- **URL state** (`useListUrlState`): facet selections live under
  `?<screenId>.f.<field>=v1,v2` keys, page-resetting on change, with
  `setFilter` / `clearFilters`.
- **Renderer**: `KumikoScreen` derives the facets from the entity's filterable
  select/boolean fields (labels via the existing `field` / `:option:` i18n
  convention) and builds `payload.filters` (booleans coerced from the URL
  strings). New `DataTableFacet` type + `filterFacets` / `filterValues` /
  `onFilterChange` / `onFilterReset` props on `DataTableProps`.
- **renderer-web**: `DefaultDataTable` renders each facet as a vendored shadcn
  `DropdownMenu` of `DropdownMenuCheckboxItem`s with an active-count badge — no
  new registry primitive.

Range filters (number/date `lt`/`gt`) are intentionally out of scope; only
equality facets (select/boolean) are rendered.
