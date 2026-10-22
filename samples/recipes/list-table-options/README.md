# List table options

Opt-in table behaviour for entity, projection and related lists. A list without
the `table` block renders and behaves as before.

## What it shows

- `table.rememberState`: search, sort, page size, facets and date range survive
  leaving and re-entering the list within the browser session.
- `table.resetAll`: one button resets everything that differs from the defaults.
- `table.columnPicker`: the view menu lets the user hide and reorder columns;
  `hidden: true` on a column starts it hidden.
- `table.density`: row density default and an optional user choice.
- `table.pinning`: the user pins columns left or right in the view menu;
  `pinned: "left"` on a column starts it pinned.
- `table.resizing`: columns can be resized (table-layout fixed); `width` and
  `minWidth` on a column are start values in px.
- `table.keyboardNavigation`: rows are one tab stop, arrow keys move between rows,
  Space selects the focused row.
- `table.export`: an Export button downloads the whole filtered list as an XLSX
  file; `maxRows` lowers the default limit of 10000 rows.
  Reference columns export their label and timestamps use the browser time zone.
- `bulkActions`: row checkboxes and a selection bar. "Delete" runs the delete
  row action once per selected row; done tasks are skipped.
- `table.grouping`: the server groups the list by status; each header shows the
  group's count and estimate sum, "done" starts collapsed and the view menu
  offers grouping by priority or none.
- `table.totals`: a footer row with the estimate sum over the filtered list.
- `facets.estimateHours: { display: "range" }`: from/to inputs for a number field.
- The same block on a `projectionList`, and `task:workload`, a hand-written list
  query that keeps grouping and totals by accepting `aggregate`
  (`entityListSchema`) and answering it with `answerListAggregate`.

## Source

Feature entry point: `src/feature.ts`.

## Tests

```bash
cd samples/recipes/list-table-options
bun test
```

The test boots the feature through the boot validator and checks that a
misspelled key, a hidden column without the picker, an unknown density, a pinned column
without `pinning`, a width without `resizing` and a bulk action on a navigate
row action are rejected.
`workload.integration.test.ts` runs the hand-written query over HTTP and checks
the grouped sums and the filtered total.
