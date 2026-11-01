---
status: reference
verified: 2026-11-01
evidence: "packages/server-runtime/src/bundled-lists-table.ts (bundledLists); packages/framework/src/engine/boot-validator/bundled-lists-table.ts; packages/framework/src/engine/define-feature.ts (adoptsBundledLists); packages/renderer/src/web/primitives/lightbox.tsx (actions, showPosition); packages/renderer/src/web/app/nav.tsx (searchParams); kumiko-framework#3570 (chart axes and height, ModeSwitch pill, LanguageSwitcher chip, useQuery concurrency); d5b87a19e (Lightbox paging); packages/renderer/src/hooks/use-query.ts; packages/renderer/src/web/widgets/charts.tsx; packages/renderer/src/web/widgets/mode-switch.tsx; packages/renderer/src/web/layout/language-switcher.tsx; packages/renderer/src/primitives.tsx; packages/types/src/screen-list-table.ts; packages/renderer/src/web/primitives/data-table/; packages/renderer/src/web/app/session-list-state-store.ts; packages/types/src/screen-list-bulk.ts; packages/renderer/src/app/list-bulk-actions.ts; packages/renderer/src/hooks/use-bulk-run.ts; samples/recipes/list-table-options"
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

## Heading group, `DetailList`, `Banner`, `ModeSwitch` and `Composer`

- `Heading variant="group"` renders a 16px semibold section heading, smaller than the page heading.
- `DetailList` takes `valueWeight="normal"` to drop the value emphasis and `layout="sidebar"` to keep a narrow label column and a right-aligned value on one row, for side columns.
- `Banner` takes an optional leading `icon` (a nav icon key such as `"alert-triangle"`) and `parts: [{ text, strong? }]` rendered after `children`; `children` is optional.
- A `ModeSwitch` option can be `disabled` and carry `tone: "warning"` to flag an open question.
- `TextareaField` takes a `placeholder`. `Composer` is a label-less chat textarea with the send button inside the frame: `value`, `onChange`, `onSubmit`, `placeholder`, `disabled`, `submitLabel`, `rows`.

## `SectionNavLayout`: "On this page" layout for custom sections

`SectionNavLayout` is the layout block for custom or extension sections that need the same table of contents as a long form. `items` is `[{ id, title }]`; each section in `children` carries the matching `id`. With no items it renders only the column. `width` takes the form column widths (default `"4xl"`), `testId` sets the test id.

```tsx
<SectionNavLayout
  items={[
    { id: "basics", title: t("basics") },
    { id: "billing", title: t("billing") },
  ]}
>
  <section id="basics">...</section>
  <section id="billing">...</section>
</SectionNavLayout>
```

Stacked `projectionDetail` and `entityEdit` screens already get this list from the form renderer (at least three titled sections). Tabs mode shows one section at a time and has no list.

## Edit `layout`: `hideRequiredMarker`

`layout: { hideRequiredMarker: true }` on an `entityEdit`, `actionForm` or `projectionDetail` hides the asterisk after required field labels. Default shown.

## `projectionDetail` header actions: `showOnTabs`

With `layout.mode: "tabs"`, a header action takes `showOnTabs: ["<tab id>"]` and is shown only while one of those tabs is active. Without it the action shows on every tab. The boot validator rejects an empty list, an id that is no section, and `showOnTabs` without tabs mode.

## Wizard (`layout.mode: "wizard"`)

| Key | Effect |
|---|---|
| section `summaryField` | A completed step shows the value of this field of the section as its subtitle in the step rail. Without it the step shows its `subtitle`, then its `description`. |
| `wizard.aside.upNext` | The "Als Nächstes" card shows the next step's title with its `subtitle`, or its `description`. |
| `wizard.aside.finishDescription` | On the last step the card shows the finish action with this text. |
| `wizard.saveAndCloseOnCreate` | Shows "Save and close" in create mode too. Default off. |
| `wizard.submitDisabledWhen` | A field condition over the form values; while it holds, every submit button is disabled and a submit is blocked. |

The intro text beside the rail follows the current step's `description` and falls back to `formSubtitle`; the same description is not printed again above the fields. After a create, extension sections are saved with the id of the new entity. The boot validator rejects the options above outside wizard mode, a `summaryField` that the section does not declare, and a `submitDisabledWhen` field that no section declares.

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
    export: { xlsx: true },
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
| `keyboardNavigation` | Rows are one tab stop. ArrowUp and ArrowDown move, Home and End jump, Enter runs the row click. Space selects the focused row when the list has `bulkActions`. |
| `compactHeader` | Renders the header row in 12px semibold. Default off. |
| `export.xlsx` | Shows an Export button that downloads the filtered list as an XLSX file. `entityList` and `projectionList` only. |
| `export.maxRows` | Row limit of one export, default 10000, hard cap 100000. |
| `grouping` | Groups the list on the server: `field`, optional `label`, `labels` and `collapsedWhen`, plus `userChoice` and `fields` for a "Group by" choice in the view menu. |
| `totals` | A footer row with `[{ field, kind }]` measures (`sum`, `avg`, `count`, `min`, `max`) over all rows that match the filters and search. |

`hidden: true` on a column starts it hidden. It needs `columnPicker`, otherwise the boot validator rejects the screen, and so does hiding every column. The boot validator also rejects unknown keys and wrong types in the block.

`pinning`, `resizing`, `keyboardNavigation` and `compactHeader` are opt-in. Without `resizing` the table keeps its auto layout and the column widths follow the content. All three have no effect in the card layout below `md`. `pinned` needs `pinning`; `width` and `minWidth` need `resizing` and must be finite numbers greater than 0, with `minWidth` not above `width`. Otherwise the boot validator rejects the screen.

**URL against store.** The URL stays the source of truth. The remembered parameters are copied into the URL once, when the list opens without any list parameter. A link that carries parameters always wins, and the remembered state follows the new URL. The page number alone does not count as a deviation. A `relatedList` keeps its state in the component and under the key `<route screenId>#<section id or query>`.

**Reset.** The button appears only while something differs from the screen defaults and replaces the facet reset. It clears the remembered list parameters. Column and density choices stay; the view menu has its own "Reset view".

**View menu.** The icon button next to the toolbar actions opens columns (checkbox, drag handle and up/down buttons) and density. The last visible column cannot be hidden. Compact density sets the row height to 32 px and the cell padding to 4 px.

**Card layout.** Below the md breakpoint the list renders as cards. Column visibility applies there, the order does not, because the cards take title, status and meta columns from the column sequence of the screen. A card sort select and the compact density still apply.

![Task list with status chips, a priority facet and the Export button in the toolbar](/screenshots/tables/export.png)

**XLSX export.** The button sends the current search, sort and facets, and the visible columns in their order, to `POST /api/export/xlsx`. The server runs the list query again with the user's session and reads the whole filtered list, not just the loaded page. Above `maxRows` it answers 413 and the button shows a hint instead of a file. The sheet drops encrypted, sensitive, write-only and unreadable fields and virtual columns, so it never holds more than the list query would show this user. Reference columns show the label of the target instead of its id, joined with commas for multiple references. Timestamps use the time zone of the browser, falling back to the profile zone and then UTC. Text cells are always plain strings, never formulas. A `projectionList` query must honor `offset` or return `nextCursor`, otherwise the export stops after the first page. Personal access tokens are rejected on this route.

**Server groups.** With `grouping` the groups are the unit that loads. One `aggregate` query with `groupBy` returns every group with its count and the `totals` measures; the header shows these server numbers, never a count or sum over loaded rows. Each open group whose header is near the viewport loads its rows with the list query plus `<field> eq <key>`, in pages of the list's page size, and "Load more" at the end of the group fetches the next page. At most four groups load at once, a collapsed group sends no query, and the global pager and infinite scroll give way to the per-group paging in both pagination modes. `userChoice` stores the chosen field like the other view choices; "None" turns grouping off. A `relatedList` section groups the same way. An `expandableRow` takes `grouping` with a fixed `field` and no `userChoice` or `fields`; every other `table` option belongs on the entityList itself. The query behind the list must accept `aggregate` (`entityListSchema` does); a hand-written query answers it with `answerListAggregate`, otherwise the boot validator rejects the screen.

**Totals row.** `totals` sends one `aggregate` query without `groupBy` over the same filters and search, kept live like the list. Money measures come back per currency and show one amount per currency. When the server caps groups or search hits, the toolbar shows a hint (`truncated`, `searchTruncated`).

**Number range facet.** `facets: { amount: { display: "range" } }` on a `number`, `decimal`, `money` or `bigInt` field that is `filterable` shows from/to inputs. They land in the URL as `<screenId>.f.<field>.min` and `.max` and reach the query as `gte`/`lte` filters. Money is typed in major units and sent in minor units (×100). Groups, totals and rows all follow the range.

**Session storage.** Choices live in `sessionStorage` under `kumiko.list.<tenantId>.<userId>.<storeKey>`, so they last for the tab only. The marker `kumiko.list.identity` records who wrote them. They are removed when the user or tenant changes, when the identity disappears, and on logout. An app without a current user keeps them in memory only and writes nothing to `sessionStorage`.

## `bundledLists`: one `table` block for the bundled lists

The bundled features (users, tenants, jobs, sessions, audit and the others) ship their list screens without a `table` block. `bundledLists` in the `composeFeatures` options sets one block for all of them, so an app does not redefine every bundled screen to get the column picker or the export button there.

```ts illustration
export default defineAppConfig({
  features: [...APP_FEATURES],
  bundledLists: {
    table: {
      rememberState: true,
      resetAll: true,
      columnPicker: true,
      density: { userChoice: true },
      pinning: true,
      resizing: true,
      keyboardNavigation: true,
      export: { xlsx: true },
    },
    pinFirstColumn: true,
  },
  client: { entries: ["src/client.tsx"] },
  ports: { dev: 4173, e2e: 4174 },
});
```

- The block reaches every `entityList`, `projectionList` and `relatedList` section of a feature that calls `r.adoptsBundledLists()`: the bundled features with lists (including the foundation features `user` and `tenant`). Feature packages such as Enterprise can call it too; a feature of the app itself never does, so its screens are not touched.
- A `table` block on the bundled screen itself wins per key. `export` is left out on `relatedList` sections, where it is not allowed.
- `grouping` and `totals` are rejected in `bundledLists.table`, because they depend on the fields of one list. Set them on the screen's own `table` block.
- `pinFirstColumn: true` pins the first column left on every bundled list where no column is pinned yet. It needs `table.pinning: true`.
- `composeFeatures` validates the block before it mixes it in. The mixed screens then pass the boot validator like any app screen, and `/api/schema` delivers them with the block, so the renderer needs no change.
- The option lives in `kumiko.config.ts` (`bundledLists`), where the managed `kumiko/schema.ts` reads it, and in the run options of `runProdApp`, `runDevApp` and `runWorkerApp` (`bundledLists`), which the app's bin files pass on like `validateBootOptions`. Both must carry the same value, so `kumiko check` and the running app see the same screens. An app whose `kumiko.config.ts` already calls `composeFeatures` can pass the option there as well; a second pass over already mixed screens changes nothing.

## List `bulkActions`

An `entityList`, `projectionList` or `relatedList` section takes `bulkActions`. Each entry names a writeHandler entry of the same screen's `rowActions`, which supplies handler, payload, label, icon, style and `visible`. The boot validator rejects an unknown id, a duplicate id and a row action of kind `clientAction`, `navigate` or `drawer`.

```ts illustration
rowActions: [
  { kind: "writeHandler", id: "delete", label: "Delete", handler: "task-board:write:task:delete", style: "danger" },
],
bulkActions: [{ id: "delete", rowAction: "delete" }],
```

With at least one bulk action the table gets a checkbox column on the left, a header checkbox for the loaded rows and a checkbox on every card in the card layout. A bar above the table shows "n selected", one button per action and "Clear selection". A list without `bulkActions` renders without the column.

![Task board with two selected rows, the bar shows 2 selected, Delete and Clear selection](/screenshots/tables/bulk-actions.png)

**Run.** A bulk action sends one `/api/write` per row, at most 4 at a time, so every row goes through the same access checks, hooks and audit event as a single click. There is no batch endpoint. Rows the row action's `visible` hides are skipped and counted. The bar shows the progress as a counter; "Cancel" stops new writes, running writes finish. Afterwards a banner shows succeeded, failed, skipped and not run, plus the first error. Failed and not-run rows stay selected for a retry, the others are deselected, and the list reloads.

**Confirm.** The dialog appears once for the whole selection and names the count. It appears when the bulk entry sets `confirm` (an i18n key with `{count}` and `{action}`) or the row action has `confirm` or `style: "danger"`.

**Limits.** The selection covers the loaded rows of the current page and at most 100 rows. There is no "select all matches across pages". With `table.keyboardNavigation`, Space toggles the focused row.

## `DataTable`: `onFilterReset`

`onFilterReset` clears all active facets. The table shows the reset button only while at least one facet is active. With `table.resetAll` the screen passes `resetAll` instead and the facet reset is not shown.

## File renderer: `previewOpenByDefault`

A field rendered with `{ format: "file" }` lists its files with a preview toggle. `previewOpenByDefault: true` opens the inline preview of the newest file (the last in the list) when the page loads, which suits a detail page whose main content is a contract or an invoice PDF:

```ts illustration
fields: [
  { field: "contractPdf", renderer: { format: "file", previewOpenByDefault: true } },
],
```

The preview mounts only for PDFs; other file types keep the closed toggle. Without the option the toggle starts closed, as before.
