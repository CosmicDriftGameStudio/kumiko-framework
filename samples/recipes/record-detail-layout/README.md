# Record Detail Layout

Register a `projectionDetail` screen as a tabbed record view ("Akte"): a
header, a metrics band, and a tabbed layout instead of one long stacked form.

## What it shows

- `header` (title/subtitle/status) and `metrics` (each with its own i18n `label`)
  rendered from the columns of the screen's own query row
- `layout.mode: "tabs"` with two `relatedList` tabs (order items, payments)
  and one `fields` tab (master data) — each `relatedList` runs its own query
- a header action with `showOnTabs: ["payments"]`, shown only while that tab is active
- guidance for a non-expert reader: a `projectionList` with `rowToneField` (row tint),
  a `hint` column (sentence, detail, tone, "Why?" reason) and a row action shown
  only when `visible` holds; on the detail screen `breadcrumb`, `summary`, `banner`
  and `steps`, each filled from a query field and dropped when the value is empty
- `focus: true` on the detail screen: the app header actions leave the shell header and the
  sidebar shows the focus rail; below 768 px a top bar replaces the header with the record
  title, a back arrow to the list screen and the page-header overflow menu
- on phones the `orders` list draws cards in the order lead sentence (the hint column, with
  detail and "Why?"), title, up to three values, then the row action; a hint column is never
  the title and a `hideOnNarrow` one stays out of the card
- boot-validator catching two common author mistakes: a `metrics` entry
  with an empty `label`, and a `tabs` layout with fewer than two
  sections

## Source

Feature entry point: `src/feature.ts`.

## Tests

```bash
cd samples/recipes/record-detail-layout
bun test
```
