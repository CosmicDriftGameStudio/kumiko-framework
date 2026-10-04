---
status: reference
verified: 2026-10-04
evidence: "packages/types/src/screen.ts (DashboardText, DashboardValueFormat); packages/renderer-web/src/app/dashboard-body.tsx; packages/renderer-web/src/widgets/charts.tsx (StackedAreaChart scrollable); packages/framework/src/engine/boot-validator/screens.ts"
---

# Dashboard panel texts and value formats

Dashboard panels show values that a query handler computes. This page covers how a handler returns translatable text, how a panel formats money, and how a stacked-area chart scrolls.

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
| `progress-list` | `rows[].label`, `rows[].value` |

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

The scroll area is a plain overflow container. There is no range selector or brush.
