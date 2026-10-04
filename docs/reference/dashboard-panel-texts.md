---
status: reference
verified: 2026-10-05
evidence: "packages/types/src/screen.ts (DashboardText, DashboardValueFormat, DashboardPanelGate, DashboardChartPanel); packages/renderer-web/src/app/dashboard-body.tsx; packages/renderer-web/src/widgets/charts.tsx (StackedAreaChart scrollable, lines, markers); packages/framework/src/engine/boot-validator/screens.ts"
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

## Scrolling stacked-area charts: `scrollable`

`scrollable: true` gives each bucket of a `stacked-area` chart a fixed width of 48 px, and the plot scrolls horizontally when the buckets do not fit. On first render the chart scrolls so that `todayMs` sits in the middle, or to the end when the result has no `todayMs`. The boot validator rejects `scrollable` on other chart kinds.

The scroll area is a plain overflow container. For a range switch see `ranges` below; there is no brush.

## Hiding panels: `visibleWhen`

`stat`, `stat-group`, `chart`, `list`, `feed` and `progress-list` panels take the same `visibleWhen` as `screen` panels:

```ts illustration
visibleWhen: { query: "loans:query:portfolio:state", field: "state", eq: "filled" }
```

The gate query returns a flat record. The panel renders only when `field` equals `eq`; while the gate loads it renders nothing, and when the gate query fails the panel's cell shows the error with a retry button. The gate query receives the screen filter and the time range, like the panel's own query. A panel with `ignoreScreenFilter` drops the filter for its gate too; a `stat-group` always passes the filter. Panels whose gates resolve to the same query and payload share one live request. The panel's own query only runs once the gate is met.

The boot validator checks that the gate query is registered and that `field` is in its `outputSchema`. It rejects `visibleWhen` on a `stat-group` child (gate the whole group instead) and an empty query or field.

## Stat groups: `subtitle` and strip icons

A labeled `stat-group` takes an optional `subtitle` (i18n key) shown next to its title. The boot validator rejects a `subtitle` without `label`. An unlabeled group renders as a KPI strip; each child keeps its `icon` and `accentColor` there too, as a small chip before the label.

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

The boot validator rejects these options on other chart kinds, an empty `ranges.options`, duplicate option values, a `default` that is not an option, a `months` that is not a positive integer, a marker kind without tone and color, and an empty color.
