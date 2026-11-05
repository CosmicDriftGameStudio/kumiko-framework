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
- a work queue on that list: named filters as one select with hit counts (`namedFilterFacet`),
  a per-filter `sort` and `emptyState` with a reset button, a badge column, per-row button
  actions (a write "Send reminder" or a link "Open order", shown by `visible`) and a summary row footer
- a `today` dashboard on the 12-column grid: a `lead` briefing (two thirds), count tiles that
  use the list's own query and link into the filtered list, a headerless "Now" list, two third
  width lists and a money group. List and dashboard answer from `src/order-board.ts`, which the
  e2e mock dispatcher shares
- on the detail screen: a second step action as a link button, metric tiles with `tone`,
  `toneField` and `navigate: { tab }`, and tab counts via `countField`; the breadcrumb stays
  unlinked because the recipe has no entity with a `detailFor` screen to link to
- phone variants: `hideOnNarrow` on dashboard panels and the progress chain, a list panel's
  `narrow` (`cards` with a `limit`, or a one-line `line` link), `narrowBlocks` on the briefing,
  `hint.plainSentence`, `showOnNarrowOnly` list columns, stat-group `columns`, and on the detail
  `summary.narrowField` and `steps.narrowLimit`; the reason of a hint stays behind its toggle unless `reasonOpenField` opens it (with `reasonTitleField` as bold lead-in; steps use `whyOpen`/`whyTitle`)
- round 5 (board gaps): a titled `stat-group` strip with a panel `icon` and per-stat `narrowLabel`,
  `narrowOrder` on a panel, `showTotal: { text, narrowText }`, `footerLink.moreText` and
  `narrowMoreText`, `narrow: { layout: "line", field }`, `rowLink` on a list panel (arrow, or
  `icon: "chevron"` for a date list), `hint.narrowDetailField` on cards, summary row items placed
  under their `column`, and on the detail `header.narrowSubtitle`, a banner action `narrowLabel`,
  `RecordStep.narrowDetail` and a `hideOnNarrow` metric. Phone cards leave out the reason toggle
- round 6 (board gaps): `rowLink.screenField` / `paramsField` (target screen from a query field),
  list panel `icon`, `narrow.moreText`, `narrow.field` as any query output field,
  `footerLink.narrowOnly`, `narrow.titleField` on cards and `rowToneMarker: "dot"`
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
