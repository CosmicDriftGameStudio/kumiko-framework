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
- `table.keyboardNavigation`: rows are one tab stop, arrow keys move between rows.
- The same block on a `projectionList`.

## Source

Feature entry point: `src/feature.ts`.

## Tests

```bash
cd samples/recipes/list-table-options
bun test
```

The test boots the feature through the boot validator and checks that a
misspelled key, a hidden column without the picker, an unknown density, a pinned column
without `pinning` and a width without `resizing` are rejected.
