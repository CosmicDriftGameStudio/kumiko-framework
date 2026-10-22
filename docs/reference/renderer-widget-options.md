---
status: reference
verified: 2026-10-22
evidence: "packages/renderer/src/web/primitives/lightbox.tsx (actions, showPosition); packages/renderer/src/web/app/nav.tsx (searchParams); kumiko-framework#3570 (chart axes and height, ModeSwitch pill, LanguageSwitcher chip, useQuery concurrency); d5b87a19e (Lightbox paging); packages/renderer/src/hooks/use-query.ts; packages/renderer/src/web/widgets/charts.tsx; packages/renderer/src/web/widgets/mode-switch.tsx; packages/renderer/src/web/layout/language-switcher.tsx; packages/renderer/src/primitives.tsx; packages/types/src/screen-list-table.ts; packages/renderer/src/web/primitives/data-table/; packages/renderer/src/web/app/session-list-state-store.ts; samples/recipes/list-table-options"
---

# Renderer widget options

Options of a few renderer hooks and widgets that are easy to miss because the defaults work without them.

## `useQuery`: `concurrency`

`useQuery(type, payload, { concurrency })` caps how many `dispatcher.query` calls of the same query name run at once under one `DispatcherProvider`. Further requests wait in line and `loading` stays `true` while they wait. A hook that unmounts, or refetches while still queued, leaves the line without taking a slot. Use it for a list of rows that each load their own detail query, so one screen does not fire fifty requests at once.

- Unset, `NaN`, infinite or below 1: no cap.
- A fractional value is floored.
- Hooks that share a query name should pass the same limit.
- Outside a `DispatcherProvider` there are no pools and the option does nothing.

```ts
const stats = useQuery<RowStats>("metrics:query:row-stats", { rowId }, { concurrency: 4 });
```

## `TimeseriesChart`: `height`, `yAxis`, `xAxis`

`TimeseriesChart` from `@cosmicdrift/kumiko-renderer/web` takes three layout options on top of `points`, `windowStartMs` and `windowEndMs`.

| Prop | Type | Effect |
|---|---|---|
| `height` | `number` | Chart height in px. Default is 64 (`h-16`). |
| `yAxis` | `{ ticks: number; format?: (value: number) => string }` | Gridlines and value labels in a left gutter. `ticks` counts the gridlines including the zero baseline (min 2, max 20). Tick values are rounded to 1, 2 or 5 times a power of ten, and the y scale reaches the top tick. `format` defaults to the plain number. |
| `xAxis` | `{ ticks: number; format: (atMs: number) => string }` | `ticks` evenly spaced time labels across the window (min 2, max 20). Replaces `axisLabels` when set. |

```tsx
<TimeseriesChart
  points={points}
  windowStartMs={windowStartMs}
  windowEndMs={windowEndMs}
  ariaLabel={t("metrics.latency")}
  height={160}
  yAxis={{ ticks: 4, format: (ms) => `${ms} ms` }}
  xAxis={{ ticks: 5, format: (atMs) => dayFormat.format(atMs) }}
/>
```

The x axis is time, not index: five minutes of data in a 30-day window draws a narrow strip at the right edge.

## `ModeSwitch`: `variant` and `className`

`ModeSwitch` is a segmented control for mutually exclusive modes. `variant` is `"outline"` (default, bordered segments with a tinted active one) or `"pill"` (grey track with a raised active segment). `className` is merged into the root element, for width or margin.

```tsx
<ModeSwitch
  variant="pill"
  className="w-full sm:w-auto"
  value={mode}
  onChange={setMode}
  options={[
    { value: "day", label: t("range.day") },
    { value: "week", label: t("range.week"), count: 3 },
  ]}
/>
```

## `LanguageSwitcher`: `variant="chip"`

`LanguageSwitcher` takes `variant: "default" | "chip"`. `chip` renders a compact monospace chip with the uppercase locale code in a border and ignores `icon` and `triggerContent`. The `aria-label` and `title` stay the translated label.

```tsx
<LanguageSwitcher variant="chip" locales={[{ code: "de", label: "Deutsch" }, { code: "en", label: "English" }]} />
```

## `Lightbox`: several images

The `Lightbox` primitive takes either one image or a browsable set. With a set the app owns the index.

```tsx
<Lightbox
  open={open}
  onOpenChange={setOpen}
  images={photos.map((p) => ({ src: p.url, alt: p.caption }))}
  index={index}
  onIndexChange={setIndex}
/>
```

Previous and next buttons, a `{current} / {total}` counter and the left and right arrow keys appear when there is more than one image. Navigation wraps at both ends. An `index` outside the set is clamped. The single-image form (`src`, `alt`) is unchanged and shows no controls. The labels come from `kumiko.lightbox.previous`, `kumiko.lightbox.next` and `kumiko.lightbox.position`.

`actions` takes nodes for the top-left corner, for example a download button. With a set, the app knows the shown image from its own `index`. `showPosition={false}` hides the counter, for images that already carry their own numbering. Paging buttons and arrow keys stay.

```tsx illustration
<Lightbox
  open={open}
  onOpenChange={setOpen}
  images={images}
  index={index}
  onIndexChange={setIndex}
  showPosition={false}
  actions={<a href={images[index].src} download>{t("photo.download")}</a>}
/>
```

## `NavApi`: `searchParams`

`navigate`, `replace` and `hrefFor` take an optional second argument `{ searchParams }`. The params become the query of the target URL. Without the option the query is dropped as before, and navigating to the current path is a no-op. With it, the same path with a different query pushes a new history entry.

A list screen reads its facet filters from `<screenId>.f.<field>` with comma-joined values. `listFilterUrlKey(screenId, field)` from `@cosmicdrift/kumiko-renderer` builds that key, so a link can open a list with a filter set.

```tsx illustration
nav.navigate(
  { screenId: "campaign-list" },
  { searchParams: { [listFilterUrlKey("campaign-list", "status")]: "open" } },
);
```

## DataTable `table` block

An `entityList`, `projectionList` or `relatedList` section takes an optional `table` block. Without it the list renders and behaves as before. The recipe `samples/recipes/list-table-options` boots a list with the full block.

```ts illustration
r.screen({
  id: "task-list",
  type: "entityList",
  entity: "task",
  columns: ["title", "status", { field: "estimateHours", hidden: true }],
  table: {
    rememberState: true,
    resetAll: true,
    columnPicker: true,
    density: { default: "comfortable", userChoice: true },
    pinning: true,
    resizing: true,
    keyboardNavigation: true,
  },
});
```

| Key | Effect |
|---|---|
| `rememberState` | Keeps search, sort, page size, facets and date range for the browser session. |
| `resetAll` | One button resets search, sort, page size, facets and date range. |
| `columnPicker` | The view menu lets the user hide and reorder columns. |
| `density.default` | Row density on first visit, `"comfortable"` or `"compact"`. Default `"comfortable"`. |
| `density.userChoice` | Shows the density choice in the view menu. |
| `pinning` | The user pins columns left or right in the view menu. Columns may start pinned with `pinned: "left" \| "right"`. Pinned columns stay sticky while scrolling horizontally. |
| `resizing` | Switches the table to `table-layout: fixed`; the user drags or uses the arrow keys on the header edge. `width` and `minWidth` (px) on a column are start values. Widths stay between `minWidth` and 2000 px and are remembered per session, like the column choice and density, whether or not `rememberState` is on. |
| `keyboardNavigation` | Rows are one tab stop. ArrowUp and ArrowDown move, Home and End jump, Enter runs the row click. Space stays reserved for selection. |

`hidden: true` on a column starts it hidden. It needs `columnPicker`, otherwise the boot validator rejects the screen, and so does hiding every column. The boot validator also rejects unknown keys and wrong types in the block.

`pinning`, `resizing` and `keyboardNavigation` are opt-in. Without `resizing` the table keeps its auto layout and the column widths follow the content. All three have no effect in the card layout below `md`. `pinned` needs `pinning`; `width` and `minWidth` need `resizing` and must be finite numbers greater than 0, with `minWidth` not above `width`. Otherwise the boot validator rejects the screen.

**URL against store.** The URL stays the source of truth. The remembered parameters are copied into the URL once, when the list opens without any list parameter. A link that carries parameters always wins, and the remembered state follows the new URL. The page number alone does not count as a deviation. A `relatedList` keeps its state in the component and under the key `<route screenId>#<section id or query>`.

**Reset.** The button appears only while something differs from the screen defaults and replaces the facet reset. It clears the remembered list parameters. Column and density choices stay; the view menu has its own "Reset view".

**View menu.** The icon button next to the toolbar actions opens columns (checkbox, drag handle and up/down buttons) and density. The last visible column cannot be hidden. Compact density sets the row height to 32 px and the cell padding to 4 px.

**Card layout.** Below the md breakpoint the list renders as cards. Column visibility applies there, the order does not, because the cards take title, status and meta columns from the column sequence of the screen. A card sort select and the compact density still apply.

**Session storage.** Choices live in `sessionStorage` under `kumiko.list.<tenantId>.<userId>.<storeKey>`, so they last for the tab only. The marker `kumiko.list.identity` records who wrote them. They are removed when the user or tenant changes, when the identity disappears, and on logout. An app without a current user keeps them in memory only and writes nothing to `sessionStorage`.

## `DataTable`: `rowGrouping`, `onFilterReset`

`rowGrouping` groups rows under collapsible headers. `keyOf` returns the group of a row, `headerLabel` the header text (a group without a label shows its rows without a header and never collapses) and `startsCollapsed` decides the initial state. A renderer without grouping support shows the flat list.

`onFilterReset` clears all active facets. The table shows the reset button only while at least one facet is active. With `table.resetAll` the screen passes `resetAll` instead and the facet reset is not shown.
