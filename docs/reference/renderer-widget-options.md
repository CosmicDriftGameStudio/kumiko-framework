---
status: reference
verified: 2026-10-04
evidence: "kumiko-framework#3570 (chart axes and height, ModeSwitch pill, LanguageSwitcher chip, useQuery concurrency); d5b87a19e (Lightbox paging); packages/renderer/src/hooks/use-query.ts; packages/renderer-web/src/widgets/charts.tsx; packages/renderer-web/src/widgets/mode-switch.tsx; packages/renderer-web/src/layout/language-switcher.tsx; packages/renderer/src/primitives.tsx"
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

`TimeseriesChart` from `@cosmicdrift/kumiko-renderer-web` takes three layout options on top of `points`, `windowStartMs` and `windowEndMs`.

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
