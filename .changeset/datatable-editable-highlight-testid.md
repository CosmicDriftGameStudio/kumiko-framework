---
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-renderer-web": minor
"@cosmicdrift/kumiko-headless": minor
---

Fix #1861: `usePrimitives().DataTable` gains three composition hooks for
apps that build the table directly (not via `RenderList`):

- `ColumnRendererProps` gains an optional `onChange`, wired from a new
  `DataTableProps.onCellChange(rowId, field, value)` — a component
  column-renderer can now mutate a cell instead of only displaying it.
- `ListColumnViewModel.highlighted` marks one column at runtime (e.g. the
  selected base-year column in a multi-year grid); `DataTable` renders its
  header and cells with a distinct background and `data-highlighted="true"`.
- `DataTableProps.getRowTestId` / `getCellTestId` override the previously
  hardcoded `row-${id}` / `cell-${id}-${field}` test-id pattern.
