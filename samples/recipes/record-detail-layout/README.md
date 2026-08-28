# Record Detail Layout

Register a `projectionDetail` screen as a tabbed record view ("Akte"): a
header, a metrics band, and a tabbed layout instead of one long stacked form.

## What it shows

- `header` (title/subtitle/status) and `metrics` (labeled via `fieldLabels`)
  rendered from the columns of the screen's own query row
- `layout.mode: "tabs"` with two `relatedList` tabs (order items, payments)
  and one `fields` tab (master data) — each `relatedList` runs its own query
- boot-validator catching two common author mistakes: a `metrics` entry
  without a `fieldLabels` override, and a `tabs` layout with fewer than two
  sections

## Source

Feature entry point: `src/feature.ts`.

## Tests

```bash
cd samples/recipes/record-detail-layout
bun test
```
