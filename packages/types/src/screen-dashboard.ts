import type { AccessRule, AgentScreenHints } from "./handlers.ts";
import type { PlatformComponent, ScreenNavSugar, ScreenSlots } from "./screen.ts";
import type { ListColumnSpec, RowAction } from "./screen-entity-list.ts";

// --- dashboard ---

// Declarative panel grid — metrics, trends and short lists without
// custom JSX. Each panel pulls its data from its own query
// (fully-qualified QN, cross-feature allowed like projectionList).
// Plain strings arrive display-ready and are shown unchanged; translatable text
// is sent as DashboardI18nText and resolved by the renderer. Numbers are
// formatted by the renderer with the user locale.

/** Text a query handler can send untranslated: the renderer translates it. */
export type DashboardI18nText = {
  readonly i18nKey: string;
  readonly i18nParams?: Readonly<Record<string, DashboardTextParam>>;
};

/** Minor units (like Money fields), formatted with the user locale. */
export type DashboardMoneyParam = {
  readonly kind: "money";
  readonly amountMinor: number;
  readonly currency: string;
};

/** Epoch ms, rendered as a medium date in the user time zone. */
export type DashboardDateParam = {
  readonly kind: "date";
  readonly atMs: number;
};

/** Epoch ms, rendered relative to now ("5 minutes ago", "in 30 seconds") in the
 *  user locale; the text keeps ticking while it is on screen. */
export type DashboardRelativeTimeParam = {
  readonly kind: "relativeTime";
  readonly atMs: number;
};

/** Nested DashboardI18nText params resolve first (e.g. a duration "{years} {months}"
 *  with one plural key each); numbers stay raw so plural rules can read `count`. */
export type DashboardTextParam =
  | string
  | number
  | DashboardI18nText
  | DashboardMoneyParam
  | DashboardDateParam
  | DashboardRelativeTimeParam;

/** Plain string is displayed as-is; DashboardI18nText is translated by the renderer. */
export type DashboardText = string | DashboardI18nText;

/** Chart/stat values are minor units, formatted with the user locale. */
export type DashboardCurrencyFormat = {
  readonly kind: "currency";
  readonly currency: string;
  /** Defaults to the currency's own decimals. */
  readonly fractionDigits?: number;
};

/** The stat value is an epoch ms timestamp, shown relative to now and kept current. */
export type DashboardRelativeTimeFormat = {
  readonly kind: "relativeTime";
};

/** Stat panels take both formats; chart panels only the currency one. */
export type DashboardValueFormat = DashboardCurrencyFormat | DashboardRelativeTimeFormat;

// Shared by every panel that runs a query.
export type DashboardPanelQueryOptions = {
  /** Static, author-set query parameters merged on top of the screen's
   *  dynamic filterParams — lets a panel pin a value (e.g. a status facet)
   *  the screen-wide filter doesn't cover, without needing its own query.
   *  The panel wins over the screen filter and the time range. */
  readonly params?: Readonly<Record<string, unknown>>;
  /** The screen `filter` value is NOT merged into this panel's query (a tenant
   *  picker must not hit sources without a tenant column). The screen
   *  `timeRange` still is. */
  readonly ignoreScreenFilter?: boolean;
};

// Gate of a top-level query panel (stat, stat-group, chart, list, feed,
// progress-list). Unlike screen panels, the gate query receives the screen
// filter (dropped with the panel's `ignoreScreenFilter`) and the time range,
// so a gate can follow a folder picker. Hidden while the gate loads.
export type DashboardPanelGate = {
  readonly visibleWhen?: DashboardPanelVisibility;
};

// Grid width of stat-group/chart/list/feed/progress-list panels. Default:
// stat-groups, charts and lists span the full row, feed and progress-list half of it.
export type DashboardPanelSpan = "half" | "full";

// Empty state of chart/list/feed/progress-list panels (i18n keys).
export type DashboardPanelEmptyState = {
  readonly span?: DashboardPanelSpan;
  readonly emptyLabel?: string;
  /** Second line under `emptyLabel`. */
  readonly emptyHint?: string;
};

// Query result contract: flat record; `valueField` points at the
// value (string is display-ready, number is locale-formatted, DashboardI18nText
// is translated), `subField` optionally at a sub line (string | DashboardI18nText), `toneField` optionally at
// "default" | "positive" | "ok" | "warn" | "negative".
// `visibleWhen` only on a top-level stat; the boot validator rejects it on a
// stat-group child (gate the whole group instead).
export const DASHBOARD_STAT_TONES = ["default", "positive", "ok", "warn", "negative"] as const;
export type DashboardStatTone = (typeof DASHBOARD_STAT_TONES)[number];

export type DashboardStatPanel = DashboardPanelQueryOptions &
  DashboardPanelGate & {
    readonly kind: "stat";
    /** Stable id: kebab-case, unique within the panel set. */
    readonly id: string;
    /** Display text (i18n key). */
    readonly label: string;
    readonly query: string;
    readonly valueField: string;
    readonly subField?: string;
    readonly toneField?: string;
    /** Formats a numeric value as currency (minor units) or, with `relativeTime`, as
     *  a ticking "5 minutes ago" from epoch ms; ignored for string values. The sparkline is not formatted. */
    readonly valueFormat?: DashboardValueFormat;
    /** Fixed tone when `toneField` is unset or yields none; not applied while the value is 0. */
    readonly tone?: DashboardStatTone;
    /** Record field holding `{ atMs, value | null }[]` (MetricResult.points),
     *  drawn as a sparkline next to the value. */
    readonly sparklineField?: string;
    /** Delta chip (e.g. "↓23 %") next to the label. It renders only when BOTH
     *  fields are set AND the query handler returns them; otherwise the tile
     *  looks as it does without a delta. `deltaToneField` falls back to
     *  `toneField`/"default" when unset. */
    readonly deltaField?: string;
    readonly deltaDirectionField?: string;
    readonly deltaToneField?: string;
    /** Static icon next to the label. Unlike value/sub/delta it does not vary
     *  per query result; it is an author decision like the panel itself.
     *  Resolved through the same extensionSectionComponents registry as custom
     *  panels; the registered component usually ignores
     *  entityName/entityId/filterParams (a plain icon has no entity context). */
    readonly icon?: PlatformComponent;
    /** Static CSS color value (e.g. "var(--color-debt)") for the icon chip,
     *  passed straight to the tile without a registry lookup. Applies ONLY when
     *  `icon` is set (StatCard renders the chip only together with an icon);
     *  without an icon the value is silently dropped. Without `accentColor` the
     *  chip follows the tone, including a `toneField` value delivered per result.
     *  An accent that should change with the result (e.g. by sign) goes through
     *  `toneField`; leave `accentColor` unset then. */
    readonly accentColor?: string;
  };

export type DashboardChartKind = "timeseries" | "stacked-bars" | "segment-bars" | "stacked-area";
export type DashboardChartTone = "positive" | "negative" | "active" | "neutral";

/** Look of the markers whose `kind` matches: a dashed guide line through the
 *  plot plus a colored pin. `color` (raw CSS color) wins over `tone`. */
export type DashboardChartMarkerKind = {
  readonly tone?: DashboardChartTone;
  readonly color?: string;
  /** i18n key; with `markerLegend: "legend"` the chart legend lists the markers of this kind under it. */
  readonly label?: string;
};

/** One option of a stacked-area range switch. Without `months` the option
 *  shows every bucket; with it, a window of that many months anchored at
 *  `todayMs` (or the last bucket). `label` is an i18n key. */
export type DashboardChartRangeOption = {
  readonly value: string;
  readonly label: string;
  readonly months?: number;
};

export type DashboardChartRanges = {
  readonly options: readonly DashboardChartRangeOption[];
  readonly default: string;
};

// Query result contracts (field names like MetricResult); series/segment/row
// labels go through t():
//   timeseries    { points: { atMs, value | null }[], windowStartMs, windowEndMs,
//                   markers?: { atMs, label: DashboardText }[] } — value=null draws a
//                   dip; markers = numbered pins on the x axis plus a
//                   numbered legend below.
//   stacked-bars  { series: { key, label, points: { atMs, value | null }[] }[],
//                   windowStartMs, windowEndMs } — vertically stacked per bucket;
//                   the last bucket is labeled "today" when it contains windowEndMs.
//                   If `series` is empty but `points` is present, `points` is drawn
//                   as a single series (plain bar chart).
//   segment-bars  { rows: { key, label, value, segments: { key, label, value }[] }[] }
//                   — one horizontally stacked bar per row.
//   stacked-area  { series, windowStartMs, windowEndMs, todayMs?,
//                   markers?: { atMs, label: DashboardText, kind? }[],
//                   lines?: { key, label, points, dashed? }[] } —
//                   stacked bands; right of `todayMs` is the forecast
//                   (lighter fill) with a vertical "today" line. `lines` are
//                   drawn unstacked on the same y scale over the bands
//                   (value=null leaves a gap).
export type DashboardChartPanel = DashboardPanelQueryOptions &
  DashboardPanelEmptyState &
  DashboardPanelGate & {
    readonly kind: "chart";
    readonly id: string;
    readonly label: string;
    readonly chart: DashboardChartKind;
    readonly query: string;
    /** i18n key under the title, e.g. "7 days, by creation day". */
    readonly subtitle?: string;
    /** Series/segment/line key -> tone; unmapped keys fall back to a palette. */
    readonly seriesTones?: Readonly<Record<string, DashboardChartTone>>;
    /** Series/segment/line key -> raw CSS color (e.g. "var(--color-debt)"); wins over `seriesTones`. */
    readonly seriesColors?: Readonly<Record<string, string>>;
    /** Formats values as currency (minor units): y ticks, legend totals and tooltips on
     *  stacked-bars/segment-bars/stacked-area, only the y ticks on timeseries. */
    readonly valueFormat?: DashboardCurrencyFormat;
    /** i18n key of a unit label. Only for chart "timeseries": shown once above the y ticks instead of on every tick. */
    readonly unit?: string;
    /** Only for chart "stacked-area": fixed width per bucket, plot scrolls horizontally. */
    readonly scrollable?: boolean;
    /** Only for chart "stacked-area": marker `kind` -> look. Markers without a
     *  declared kind keep the neutral numbered pin. */
    readonly markerKinds?: Readonly<Record<string, DashboardChartMarkerKind>>;
    /** Only for chart "stacked-area": false hides the per-series sums in the
     *  legend (they mean nothing for balances). Default true. */
    readonly legendTotals?: boolean;
    /** Only for chart "stacked-area": range switch in the panel header. */
    readonly ranges?: DashboardChartRanges;
    /** Only for chart "stacked-area": scrubber under the plot to drag the visible window; starts at today. */
    readonly brush?: boolean;
    /** Only for chart "stacked-area": date format of axis and marker labels.
     *  Default automatic: day and month below 18 visible months, month and year above. */
    readonly dateFormat?: "day" | "month";
    /** Only for chart "stacked-area": window the uncontrolled chart starts in.
     *  "from-today" starts at today even when `ranges.default` is set. Default "default-range". */
    readonly initialWindow?: "default-range" | "from-today";
    /** Only for chart "stacked-area": "legend" drops the numbered marker list; pins become
     *  plain dots with a tooltip and the legend lists marker kinds (see `markerKinds[].label`). Default "list". */
    readonly markerLegend?: "list" | "legend";
    /** Only for chart "stacked-area": true writes each marker label vertically next to its guide line on wide panels; narrow panels keep the pins. Default false. */
    readonly markerLabels?: boolean;
  };

// Short list on the dashboard — query contract like projectionList
// (`{ rows, nextCursor, total? }`), rendered without pager/toolbar.
export type DashboardListPanel = DashboardPanelQueryOptions &
  DashboardPanelEmptyState &
  DashboardPanelGate & {
    readonly kind: "list";
    readonly id: string;
    readonly label: string;
    readonly query: string;
    readonly columns: readonly ListColumnSpec[];
  };

// Section of several stat panels (e.g. "Net Worth": Assets/Debts/Net). One
// nesting level, no group-of-groups: each child stays a full
// DashboardStatPanel with its own query/id/label. With `label` it sits under a
// section title; without `label` it renders as a flat KPI strip (dividers, no card).
// The gate query of a group always receives the screen filter.
export type DashboardStatGroupPanel = DashboardPanelGate & {
  readonly kind: "stat-group";
  readonly id: string;
  readonly label?: string;
  /** i18n key, a line under `label`; the boot validator requires `label`. */
  readonly subtitle?: string;
  readonly span?: DashboardPanelSpan;
  readonly stats: readonly DashboardStatPanel[];
};

// Non-tabular short list (e.g. "upcoming appointments"). Query result
// contract: `{ rows: { primary: DashboardText; trailing?: DashboardText }[] }`.
export type DashboardFeedPanel = DashboardPanelQueryOptions &
  DashboardPanelEmptyState &
  DashboardPanelGate & {
    readonly kind: "feed";
    readonly id: string;
    readonly label: string;
    readonly query: string;
  };

export type DashboardProgressTone = "default" | "danger";

// List of label/value/progress bar (e.g. repayment progress per loan or usage per cap).
// Query result contract, one of two row shapes (`sub` and `tone` work in both):
//   fraction mode  { label: DashboardText; value: DashboardText; fraction: number;
//                    sub?: DashboardText; tone?: DashboardProgressTone }
//   used/limit mode { label: DashboardText; used: number; limit: number | null;
//                    sub?: DashboardText; tone?: DashboardProgressTone }
// `fraction` is clamped to 0..1; `sub` is a small line below the bar (e.g. "42 % repaid").
// In used/limit mode the renderer shows "<used> / <limit>" and fills the bar with
// used / limit (limit 0 fills it completely). `limit: null` shows "<used> / unlimited"
// and no bar. `tone` "danger" colors bar and value; used/limit rows default to "danger"
// once `used >= limit`, fraction rows never get a tone automatically.
export type DashboardProgressListPanel = DashboardPanelQueryOptions &
  DashboardPanelEmptyState &
  DashboardPanelGate & {
    readonly kind: "progress-list";
    readonly id: string;
    readonly label: string;
    readonly query: string;
  };

// Mounted app component that manages its own data/title (like a custom
// screen, only as a panel — stays at its array position instead of moving
// to a separate slot). No `query`, no `label`: the renderer resolves
// `component` through the same extensionSectionComponents registry as
// entityEdit extension sections and list-header slots.
export type DashboardCustomPanel = {
  readonly kind: "custom";
  readonly id: string;
  readonly component: PlatformComponent;
  /** Static author values laid over the screen's filterParams, like
   *  `DashboardPanelQueryOptions.params`; the panel wins on a name clash. */
  readonly params?: Readonly<Record<string, unknown>>;
};

// Static text panel without a query. Every `text` and `items` entry is an i18n key
// (a missing translation falls back to the literal); only `code` is shown verbatim.
export type DashboardTextBlock =
  | { readonly kind: "heading"; readonly text: string }
  | {
      readonly kind: "paragraph";
      readonly text: string;
      /** Default "muted", like body copy inside panels. */
      readonly emphasis?: "muted" | "strong";
    }
  | { readonly kind: "list"; readonly items: readonly string[] }
  | { readonly kind: "code"; readonly code: string }
  | { readonly kind: "hint"; readonly text: string }
  | {
      readonly kind: "link";
      /** Link label (i18n key). */
      readonly text: string;
      /** Same-feature short id or cross-feature QN `<feature>:screen:<id>`. */
      readonly screen: string;
      /** Show the link only to users holding one of these roles. Display
       *  gate only: the target screen's own `access` stays the enforcement. */
      readonly roles?: readonly string[];
    };

export type DashboardTextPanel = DashboardPanelGate & {
  readonly kind: "text";
  readonly id: string;
  /** Panel title (i18n key). */
  readonly label?: string;
  readonly span?: DashboardPanelSpan;
  readonly blocks: readonly DashboardTextBlock[];
};

// Live query, so a write that flips `field` swaps panels without reload; hidden while loading.
export type DashboardPanelVisibility = {
  readonly query: string;
  readonly field: string;
  readonly eq: string | number | boolean | null;
};

// Screen-level gate. Panels keep the empty-payload DashboardPanelVisibility; a screen that
// shows one record can hand its route id to the gate query.
export type ScreenVisibility = DashboardPanelVisibility & {
  /** Payload key that receives the screen's route id (projectionDetail only). Without it
   *  the gate query runs with an empty payload. */
  readonly idParam?: string;
};

/** Why a screen gate is not open. `hidden`: the gate query answered but the condition is unmet
 *  (also a missing route id with `idParam`); `forbidden`/`notFound`: the gate query failed with
 *  HTTP 403/404; `error`: any other failure. */
export type ScreenFallbackReason = "hidden" | "forbidden" | "notFound" | "error";

/** Per-reason fallback screens (same-feature short id or cross-feature QN). A reason without an
 *  entry gets the default notice. At least one key is required. */
export type ScreenFallbackByReason = {
  readonly [Reason in ScreenFallbackReason]?: string;
};

/** Screen-level `fallback`: one screen for every reason, or one per reason. */
export type ScreenFallback = string | ScreenFallbackByReason;

export const SCREEN_FALLBACK_REASONS: readonly ScreenFallbackReason[] = [
  "hidden",
  "forbidden",
  "notFound",
  "error",
];

/** The fallback screen for one reason, or undefined when the map has no entry for it. */
export function fallbackTargetFor(
  fallback: ScreenFallback,
  reason: ScreenFallbackReason,
): string | undefined {
  return typeof fallback === "string" ? fallback : fallback[reason];
}

/** Every screen a fallback can render, in reason order. */
export function fallbackTargets(fallback: ScreenFallback): readonly string[] {
  if (typeof fallback === "string") return [fallback];
  return SCREEN_FALLBACK_REASONS.flatMap((reason) => fallback[reason] ?? []);
}

// Embedded redirect/cancelTarget navigate away from the dashboard — targets meant for tiles omit both.
export type DashboardScreenPanel = {
  readonly kind: "screen";
  readonly id: string;
  /** Same-feature short id or cross-feature QN `<feature>:screen:<id>`. */
  readonly screen: string;
  readonly label?: string;
  readonly visibleWhen?: DashboardPanelVisibility;
  /** Same-feature short id or cross-feature QN `<feature>:screen:<id>` embedded in this
   *  panel's place when `visibleWhen` is unmet or its query fails (nothing while it loads).
   *  Needs `visibleWhen`; the target must not have a `visibleWhen` of its own. */
  readonly fallback?: string;
  /** Render the embedded form without its own card frame and padding, aligned to
   *  the dashboard's page grid like a standalone settings screen. Default false
   *  (framed card); set for panels whose body is a settings-list form, where a
   *  card inside the page would double the inset. */
  readonly chromeless?: boolean;
};

export type DashboardPanelDefinition =
  | DashboardStatPanel
  | DashboardStatGroupPanel
  | DashboardChartPanel
  | DashboardListPanel
  | DashboardFeedPanel
  | DashboardProgressListPanel
  | DashboardTextPanel
  | DashboardCustomPanel
  | DashboardScreenPanel;

// Screen-wide picker (combobox) whose selected value is merged under `id`
// into EVERY panel query of this screen (query handlers validate the value
// themselves against the tenant view — this is UX scoping, not an access
// boundary). Exactly one of `options`/`optionsQuery` is set (the boot
// validator checks).
export type DashboardFilterDefinition = {
  readonly id: string;
  readonly label: string;
  readonly kind: "select";
  readonly placeholder?: string;
  /** i18n key for the "(all)" entry. */
  readonly allLabel?: string;
  readonly options?: readonly { readonly value: string; readonly label: string }[];
  /** Query-Result-Contract: `{ rows: { value: string; label: string }[] }`. */
  readonly optionsQuery?: string;
};

export type DashboardTimeRangeDefinition = {
  readonly id: string;
  /** `label` is an i18n key. */
  readonly options: readonly { readonly value: string; readonly label: string }[];
  readonly default: string;
};

// i18n keys: `badge` is a pill next to the title, `notice` an info strip under the toolbar.
export type DashboardScopeDefinition = {
  readonly badge: string;
  readonly notice?: string;
};

/** Minimum polling interval of `DashboardScreenDefinition.refresh`; shorter values are rejected
 *  at boot (`seconds`) or raised at runtime (`field`). */
export const DASHBOARD_MIN_REFRESH_SECONDS = 5;

// Ties a dashboard to one record, identified by a URL search param. The id is
// merged into every panel query and visibleWhen gate query of the screen
// (screen-kind panels get none), after `filter` and `timeRange` and before a
// panel's own `params`: a panel can still pin its own value, the screen filter
// cannot override the record key.
export type DashboardRecordBinding = {
  /** URL search param carrying the record id. Without it the dashboard shows a
   *  hint instead of its panels and runs no query. */
  readonly param: string;
  /** Key of the id in each panel query payload. Default: `param`. */
  readonly payloadKey?: string;
  /** Optional query for the record row (QN). It receives `{ [payloadKey]: id }`
   *  and returns a flat row; `actions` take that row as their input and
   *  `refresh.field` and `titleField` read from it. */
  readonly query?: string;
  /** Field of the record row shown as the page title. Needs `query`. */
  readonly titleField?: string;
};

/** Polling of the record and all panel queries, never faster than
 *  DASHBOARD_MIN_REFRESH_SECONDS. `field` reads the seconds from the record row
 *  (needs `record.query`), so a monitor can be polled at its own check interval. */
export type DashboardRefresh = { readonly seconds: number } | { readonly field: string };

export type DashboardScreenDefinition = {
  readonly id: string;
  readonly type: "dashboard";
  readonly nav?: ScreenNavSugar;
  readonly detailFor?: string;
  readonly description?: string;
  readonly agent?: AgentScreenHints;
  /** Screen has no nav entry by design (opened via link or navved by the
   *  app); exempts it from the nav-area boot check. */
  readonly dormant?: boolean;
  /** UI-only gate, also on direct URL access; handlers still enforce access. Unmet or failed renders `fallback`. */
  readonly visibleWhen?: ScreenVisibility;
  /** Same-feature short id or cross-feature QN `<feature>:screen:<id>` shown when `visibleWhen` is unmet (default: standard notice). */
  readonly fallback?: ScreenFallback;
  readonly panels: readonly DashboardPanelDefinition[];
  /** Binds the dashboard to one record via a URL search param, see DashboardRecordBinding. */
  readonly record?: DashboardRecordBinding;
  /** Header actions on the bound record (writeHandler, navigate, clientAction).
   *  The row is the `record.query` row, or `{ id, [payloadKey]: id }` without a
   *  query. After a success the record and all panels refetch. Needs `record`;
   *  no drawer, redirect or rowClick. */
  readonly actions?: readonly RowAction[];
  readonly refresh?: DashboardRefresh;
  readonly filter?: DashboardFilterDefinition;
  /** Segmented control in the toolbar; the value lives in URL search param
   *  `id` and is merged into EVERY panel query (also ignoreScreenFilter ones). */
  readonly timeRange?: DashboardTimeRangeDefinition;
  /** Marks the screen as spanning more than the caller's own scope. */
  readonly scope?: DashboardScopeDefinition;
  /** Show the "Updated at" timestamp in the toolbar. Default true; turn off for
   *  dashboards that host forms rather than live metrics, where a load time
   *  next to the form reads as stale data. */
  readonly showUpdatedAt?: boolean;
  readonly slots?: ScreenSlots;
  readonly access?: AccessRule;
};
