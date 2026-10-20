---
status: reference
verified: 2026-10-15
evidence: "packages/types/src/screen.ts (DashboardText, DashboardValueFormat, DashboardPanelGate, DashboardChartPanel); packages/renderer/src/web/app/dashboard-body.tsx; packages/renderer/src/web/widgets/stat.tsx; packages/renderer/src/web/widgets/charts.tsx (StackedAreaChart scrollable, lines, markers); packages/framework/src/engine/boot-validator/screens.ts"
---

# Dashboard panel texts and value formats

Dashboard panels show values that a query handler computes. This page covers how a handler returns translatable text, how a panel formats money, how panels hide behind a gate query, and the extra options of stat groups and stacked-area charts.

## Translatable texts from query handlers

A handler cannot call `t()` for the viewer, so it returns a `DashboardText` and the renderer translates it:

```ts illustration
type DashboardText = string | DashboardI18nText;

type DashboardI18nText = {
  i18nKey: string;
  i18nParams?: Record<string, DashboardTextParam>;
};

type DashboardTextParam =
  | string
  | number
  | DashboardI18nText
  | { kind: "money"; amountMinor: number; currency: string }
  | { kind: "date"; atMs: number };
```

A plain string is shown as it is, so existing handlers keep working. These result fields accept a `DashboardText`:

| Panel | Fields |
|---|---|
| `stat` | the `valueField` value and the `subField` value |
| `chart` (`timeseries`, `stacked-area`) | `markers[].label` |
| `feed` | `rows[].primary`, `rows[].trailing` |
| `progress-list` | `rows[].label`, `rows[].value`, `rows[].sub` (optional line under the bar, e.g. "40 % paid off") |

The renderer resolves params before it calls `t()`:

- A number stays a number, so plural keys can read `count`.
- A money param is formatted from minor units with the viewer's locale, like a Money field.
- A date param is formatted as a medium date in the viewer's time zone.
- A nested `DashboardI18nText` is translated first and passed in as a string. Nesting stops after four levels; deeper texts show their key.

Interpolation only supports `{name}` and plural forms, so a handler should not try to format numbers or dates itself. A duration such as "2 years 3 months" is one key with two nested plural keys:

```ts illustration
return {
  remaining: {
    i18nKey: "loans.remaining",
    i18nParams: {
      years: { i18nKey: "loans.years", i18nParams: { count: 2 } },
      months: { i18nKey: "loans.months", i18nParams: { count: 3 } },
    },
  },
};
```

## Currency values: `valueFormat`

`stat` and `chart` panels take an optional `valueFormat`:

```ts illustration
valueFormat: { kind: "currency", currency: "EUR", fractionDigits: 0 }
```

The value is in minor units (cents). `fractionDigits` defaults to the currency's own decimals. On a stat panel the format applies to a numeric value; a string value is shown unchanged and the sparkline stays unformatted. On `stacked-bars`, `segment-bars` and `stacked-area` charts it applies to the y axis ticks, legend totals and tooltips. A `timeseries` chart uses it only for its y axis ticks. The boot validator rejects a currency that is not three upper-case letters and a `fractionDigits` outside 0 to 4.

A `timeseries` chart also takes `unit` (i18n key, e.g. for "ms"). The unit is shown once above the y axis ticks, and the ticks show only the number. The boot validator rejects `unit` on other chart kinds.

## Usage against a limit: progress-list `used` and `limit`

A `progress-list` row can return `used: number` and `limit: number | null` instead of `value` and `fraction`. The row then shows "used / limit" in the viewer's number format and fills the bar with `used / limit`; `limit: 0` fills it completely. `limit: null` shows "used / unlimited" (translated through `kumiko.dashboard.progress.unlimited`) and draws no bar, because an empty bar would read as 0 %.

`tone: "danger"` colors bar and value. Used/limit rows get it automatically once `used >= limit`, an explicit `tone` wins either way. Fraction rows never get a tone automatically, since a full bar can be good news such as a repaid loan.

## Scrolling stacked-area charts: `scrollable`

`scrollable: true` gives each bucket of a `stacked-area` chart a fixed width of 48 px, and the plot scrolls horizontally when the buckets do not fit. On first render the chart scrolls so that `todayMs` sits in the middle, or to the end when the result has no `todayMs`. The boot validator rejects `scrollable` on other chart kinds.

The scroll area is a plain overflow container. For a range switch see `ranges` below; there is no brush.

## Hiding panels: `visibleWhen`

`stat`, `stat-group`, `chart`, `list`, `feed`, `progress-list` and `text` panels take the same `visibleWhen` as `screen` panels:

```ts illustration
visibleWhen: { query: "loans:query:portfolio:state", field: "state", eq: "filled" }
```

The gate query returns a flat record. The panel renders only when `field` equals `eq`; while the gate loads it renders nothing, and when the gate query fails the panel's cell shows the error with a retry button. The gate query receives the screen filter and the time range, like the panel's own query. A panel with `ignoreScreenFilter` drops the filter for its gate too; a `stat-group` always passes the filter. Panels whose gates resolve to the same query and payload share one live request. The panel's own query only runs once the gate is met.

The boot validator checks that the gate query is registered and that `field` is in its `outputSchema`. It rejects `visibleWhen` on a `stat-group` child (gate the whole group instead) and an empty query or field.

A `screen` panel takes a `fallback` screen (same-feature short id or `<feature>:screen:<id>`) that is embedded in its place when the gate is unmet or its query fails; while the gate loads nothing renders. `chromeless` and the panel `label` apply to the fallback too. The boot validator rejects `fallback` without `visibleWhen`, an unresolvable or non-embeddable target, and a target with its own `visibleWhen`. A role without access to the fallback screen gets the panel without it.

## Static text: the `text` panel

A `text` panel has no query. It renders `blocks`, an optional `label` as title and the usual `span` and `visibleWhen`:

```ts illustration
{
  kind: "text",
  id: "getting-started",
  label: "app:help:title",
  blocks: [
    { kind: "heading", text: "app:help:heading" },
    { kind: "paragraph", text: "app:help:body", emphasis: "strong" },
    { kind: "list", items: ["app:help:step-1", "app:help:step-2"] },
    { kind: "code", code: "curl https://api.example.test/health" },
    { kind: "hint", text: "app:help:hint" },
    { kind: "link", text: "app:help:open-profile", screen: "profile", roles: ["TenantAdmin"] },
  ],
}
```

`text` and every list item are i18n keys and count as required translation keys; `code` is shown verbatim in a horizontally scrollable block. `paragraph` is muted by default, `emphasis: "strong"` uses the foreground color. There is no markdown or HTML. A `link` block shows a link to a screen (`screen` is a short id or a qualified name). With `roles` it is shown only to users holding one of them; this only hides the link, the target screen still checks access on the server. The boot validator rejects empty `blocks`, a `list` without items, a `link` to an unknown screen and an empty `roles`.

## Stat groups: `subtitle`, `span` and strip icons

A labeled `stat-group` takes an optional `subtitle` (i18n key) shown next to its title. The boot validator rejects a `subtitle` without `label`. An unlabeled group renders as a KPI strip; each child keeps its `icon` and `accentColor` there too, as a small chip before the label.

A `stat-group` takes `span: "half"` or `"full"` like the other panels and defaults to the full row. Two half-width groups sit next to each other on large screens. A labeled group gets one column per value, up to three.

`accentColor` is static. When the icon chip should change color with the result, for example a net cash flow that turns from positive to negative, leave `accentColor` unset and return the tone from `toneField`: the value and the chip both follow it.

Stat tones are `default`, `positive`, `ok`, `warn` and `negative`. `ok` renders in the status green; `positive` follows the theme primary color, which some apps set to a near-black brand color.

## Stacked-area extras: lines, marker kinds, colors, ranges

A `stacked-area` result can carry unstacked lines and typed markers next to its `series`:

```ts illustration
{
  series: [{ key: "remaining", label: "loans.remaining", points }],
  lines: [
    { key: "rent", label: "loans.rent", points: rentPoints },
    { key: "rent-min", label: "loans.rent-min", points: minRentPoints, dashed: true },
  ],
  markers: [{ atMs, label: "Extra payment", kind: "extra" }],
}
```

Lines use the same y scale as the bands and count toward its maximum; a `null` value leaves a gap. They appear in the legend with a line swatch and no total. The panel takes these options, all only valid on `stacked-area` except `seriesColors`:

| Option | Effect |
|---|---|
| `seriesColors` | series, segment or line key to a raw CSS color (e.g. `"var(--color-debt)"`); wins over `seriesTones`. All chart kinds except `timeseries`. |
| `markerKinds` | marker `kind` to `{ tone }` or `{ color }`. Matching markers get a colored pin and a dashed guide line through the plot; markers without a declared kind keep the neutral pin. |
| `legendTotals` | `false` hides the per-series sums in the legend (useful for balances). Default `true`. |
| `ranges` | a range switch in the panel header: `{ options: { value, label, months? }[], default }`. An option with `months` shows a window of that many months starting at `todayMs` (or the last bucket), moved back when the data ends earlier. An option without `months` shows everything. Bands, lines and markers are all filtered to the window. |
| `brush` | `true` adds a scrubber under the plot to drag the visible window; without `ranges` it starts at today. |
| `initialWindow` | `"from-today"` starts at today even when `ranges.default` is set. Default `"default-range"`. |
| `dateFormat` | `"day"` or `"month"` for axis and marker labels. Default automatic: day and month below 18 visible months, month and year above. |
| `markerLegend` | `"legend"` drops the numbered marker list: pins become plain dots with a tooltip and the legend lists marker kinds (see `markerKinds[].label`). Default `"list"`. |
| `markerLabels` | `true` writes each marker label vertically next to its guide line on wide panels; narrow panels keep the pins. Markers with the same timestamp share one label. Default `false`. |

The boot validator rejects these options on other chart kinds, an empty `ranges.options`, duplicate option values, a `default` that is not an option, a `months` that is not a positive integer, a marker kind without tone and color, an empty color, and a non-boolean `brush`, `legendTotals` or `markerLabels`.
