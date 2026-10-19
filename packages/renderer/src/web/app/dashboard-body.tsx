// Web implementation of the dashboard screen type: renders the declared
// panels via the widget kit (StatCard, charts, FeedList, ProgressList,
// DashboardListTable) in a responsive grid. Registered via
// DashboardBodyProvider in createKumikoApp so the KumikoScreen switch stays
// platform-agnostic.
//
// Panel data contracts (see DashboardPanelDefinition in kumiko-framework):
//   stat          → flat record; valueField/subField/toneField point at
//                   values (strings are display-ready, DashboardI18nText is
//                   translated, the renderer formats numbers with the user
//                   locale; `valueFormat` renders them as currency from minor
//                   units). sparklineField → { atMs, value }[].
//                   deltaField/deltaDirectionField(+deltaToneField) are
//                   optional: the tile shows a delta chip ("↓23 %") only when
//                   BOTH fields are configured AND returned.
//                   icon/accentColor are static on the panel (not query
//                   fields): icon goes through extensionSectionComponents like
//                   custom panels, accentColor is a raw CSS color value.
//   stat-group    → several stat panels, each child stays an independent
//                   query; with a label it sits under a section title,
//                   without one it renders as a flat KPI strip. `span` works
//                   like on other panels; columns follow the number of values.
//   chart         → depends on `chart`: timeseries { points, windowStartMs,
//                   windowEndMs, markers? }, stacked-bars / stacked-area
//                   { series, windowStartMs, windowEndMs, todayMs?, markers? }
//                   (marker labels: DashboardText; `scrollable`, `ranges` and
//                   `brush` only for stacked-area),
//                   segment-bars { rows: { key, label, value, segments }[] }
//   list          → paged envelope { rows, nextCursor, total? } like
//                   projectionList.
//   feed          → { rows: { primary: DashboardText, trailing?: DashboardText }[] }
//   progress-list → { rows: { label: DashboardText, value: DashboardText, fraction }[] }
//                   or, per row, used / limit instead of value / fraction
//   text          → no query; static `blocks` (heading, paragraph, list, code, hint),
//                   text/items are i18n keys, code is shown verbatim.
//   custom        → no query; an app component registered via
//                   extensionSectionComponents fetches its own data.
//   screen        → no own query; embeds another declarative screen via
//                   KumikoScreen. visibleWhen reads a flat record (live); the
//                   tile is dropped when the user can't access the target.
//
// Screen filter (DashboardFilterDefinition) and time range (timeRange): the
// selected values are merged into the panel queries under `filter.id` /
// `timeRange.id` (panel `params` win, `ignoreScreenFilter` drops only the
// filter). useQuery refetches automatically through its existing payloadKey
// mechanism, so no special case is needed. Each query panel loads and fails
// on its own (skeleton / empty / error with retry).
//
// Record binding (DashboardRecordBinding): the record id from the URL search
// param is merged into every panel and gate query after filter/timeRange and
// before panel `params`. Without the param the screen shows a hint and runs no
// query. `record.query` loads the row for the title, header `actions` and
// `refresh.field`; an action success and every refresh tick refetch the record
// and all panels (each panel query registers its refetch in the registry).

import type {
  DashboardChartMarkerKind,
  DashboardChartPanel,
  DashboardCurrencyFormat,
  DashboardCustomPanel,
  DashboardDateParam,
  DashboardFeedPanel,
  DashboardI18nText,
  DashboardListPanel,
  DashboardMoneyParam,
  DashboardPanelDefinition,
  DashboardPanelEmptyState,
  DashboardPanelQueryOptions,
  DashboardProgressListPanel,
  DashboardProgressTone,
  DashboardRelativeTimeParam,
  DashboardScreenDefinition,
  DashboardScreenPanel,
  DashboardStatGroupPanel,
  DashboardStatPanel,
  DashboardTextBlock,
  DashboardTextPanel,
  DashboardTextParam,
} from "@cosmicdrift/kumiko-framework/ui-types";
import { normalizeListColumn } from "@cosmicdrift/kumiko-framework/ui-types";
import { DASHBOARD_STAT_TONES } from "@cosmicdrift/kumiko-types/screen";
import { isOneOf } from "@cosmicdrift/kumiko-types/type-guards";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { currencyDecimals, EMPTY_VALUE_PLACEHOLDER, type Translate } from "../../headless/index.ts";
import {
  type DashboardBodyProps,
  dispatcherErrorText,
  EmbeddedScreenProvider,
  type EmbeddedScreenTarget,
  evalVisibleWhen,
  extensionSectionName,
  HeaderActionsBar,
  KumikoScreen,
  type UseQueryResult,
  useEmbeddedScreen,
  useExtensionSectionComponent,
  useLocale,
  useNav,
  usePageHeaderCompact,
  usePageHeaderSlotAvailable,
  usePrimitives,
  useQuery,
  useRecordActions,
  useTranslation,
} from "../../index.ts";
import { cn } from "../lib/cn.ts";
import { EmbeddedFormProvider } from "../primitives/index.tsx";
import { PageSection } from "../primitives/layout.tsx";
import { resolveSafeLocale } from "../primitives/locale-number.ts";
import { formatMoney } from "../primitives/money-input.tsx";
import { Skeleton } from "../ui/skeleton.tsx";
import {
  initialWindowSelection,
  type StackedAreaDateFormat,
  type StackedAreaRanges,
} from "../widgets/chart-window.ts";
import {
  type ChartLine,
  type ChartMarker,
  type ChartSeries,
  chartToneColor,
  SegmentBarChart,
  type SegmentBarRow,
  StackedAreaChart,
  StackedBarChart,
  TimeseriesChart,
  type TimeseriesPoint,
} from "../widgets/charts.tsx";
import { DashboardListTable } from "../widgets/dashboard-list.tsx";
import { FeedList, type FeedRow } from "../widgets/feed-list.tsx";
import { ModeSwitch } from "../widgets/mode-switch.tsx";
import { ProgressList, type ProgressListRow } from "../widgets/progress-list.tsx";
import { SectionCard } from "../widgets/section-card.tsx";
import { StatCard, type StatDelta, StatStripCell, type StatTone } from "../widgets/stat.tsx";
import { EmptyState, LoadingState } from "../widgets/states.tsx";
import { StatusBadge } from "../widgets/status-badge.tsx";
import { resolveRefreshIntervalMs } from "./dashboard-refresh.ts";
import { useRelativeTimeFormatter } from "./relative-time.ts";

const SKELETON_SEGMENT_WIDTHS = ["100%", "72%", "48%"] as const;
const WIDE_PANEL = "sm:col-span-2 lg:col-span-4";
const HALF_PANEL = "sm:col-span-2 lg:col-span-2";
const CURRENCY_CODE_PATTERN = /^[A-Za-z]{3}$/;
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const SKELETON_BAR_HEIGHTS = ["40%", "65%", "50%", "85%", "60%", "75%", "45%", "70%"];

type ScreenParams = {
  readonly filterParams: Readonly<Record<string, unknown>>;
  readonly rangeParams: Readonly<Record<string, unknown>>;
  /** `{ [payloadKey]: recordId }` of a record-bound dashboard, else empty. */
  readonly recordParams: Readonly<Record<string, unknown>>;
};

function panelPayload(
  panel: DashboardPanelQueryOptions,
  screenParams: ScreenParams,
): Readonly<Record<string, unknown>> {
  return {
    ...(panel.ignoreScreenFilter === true ? {} : screenParams.filterParams),
    ...screenParams.rangeParams,
    ...screenParams.recordParams,
    ...panel.params,
  };
}

type RefetchQuery = () => Promise<void>;

type DashboardQueryRuntime = {
  /** Polling interval for every panel and gate query; undefined = off. */
  readonly refreshIntervalMs: number | undefined;
  /** Adds a query's refetch to the set `refetchAll` walks; returns its removal. */
  readonly register: (refetch: RefetchQuery) => () => void;
};

const DashboardQueryContext = createContext<DashboardQueryRuntime>({
  refreshIntervalMs: undefined,
  register: () => () => {},
});

function useRefetchRegistry(): {
  readonly register: DashboardQueryRuntime["register"];
  readonly refetchRegistered: () => Promise<void>;
} {
  const registered = useRef(new Set<RefetchQuery>());
  const register = useCallback((refetch: RefetchQuery) => {
    registered.current.add(refetch);
    return () => {
      registered.current.delete(refetch);
    };
  }, []);
  const refetchRegistered = useCallback(async () => {
    await Promise.all([...registered.current].map((refetch) => refetch()));
  }, []);
  return { register, refetchRegistered };
}

/** Live query of a panel or gate that takes part in the dashboard's refresh:
 *  polls at the screen's interval and is refetched by `refetchAll` after an
 *  action. A disabled query registers nothing. */
function useDashboardQuery<TData>(
  type: string,
  payload: Readonly<Record<string, unknown>>,
  options: { readonly enabled?: boolean } = {},
): UseQueryResult<TData> {
  const { refreshIntervalMs, register } = useContext(DashboardQueryContext);
  const enabled = options.enabled ?? true;
  const result = useQuery<TData>(type, payload, {
    live: true,
    enabled,
    ...(refreshIntervalMs !== undefined && { refetchIntervalMs: refreshIntervalMs }),
  });
  const { refetch } = result;
  useEffect(() => (enabled ? register(refetch) : undefined), [enabled, register, refetch]);
  return result;
}

type DashboardFormats = {
  readonly timeZone: string;
  readonly formatNumber: (value: number) => string;
  readonly formatPercent: (fraction: number) => string;
  readonly formatDay: (atMs: number) => string;
  readonly formatMonth: (atMs: number) => string;
  readonly formatHour: (atMs: number) => string;
  readonly formatDateTime: (atMs: number) => string;
  readonly formatMedium: (atMs: number) => string;
  readonly formatMinor: (amountMinor: number, currency: string, fractionDigits?: number) => string;
  /** "5 minutes ago"; the component that called `useDashboardFormats` redraws on a
   *  timer while at least one of its renders used this. */
  readonly formatRelative: (atMs: number) => string;
  /** Number formatter for a panel; currency when `valueFormat` is set. */
  readonly formatPanelValue: (
    valueFormat: DashboardCurrencyFormat | undefined,
  ) => (value: number) => string;
  /** Compact variant of `formatPanelValue` for chart axes ("1,5 Mio. €"). */
  readonly formatPanelAxisValue: (
    valueFormat: DashboardCurrencyFormat | undefined,
  ) => (value: number) => string;
};

function useDashboardFormats(): DashboardFormats {
  const resolver = useLocale();
  const locale = resolver.locale();
  const timeZone = resolver.timeZone();
  const formatRelative = useRelativeTimeFormatter(locale);
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  // Without the significant-digit cap, values below the locale's first
  // abbreviation step keep a decimal ("298.989,9 €" in de); lessPrecision
  // picks whichever rule rounds more, so that becomes "299.000 €" while
  // "1,5 Mio. €" keeps its one decimal.
  const compactOptions = {
    notation: "compact",
    maximumFractionDigits: 1,
    maximumSignificantDigits: 3,
    roundingPriority: "lessPrecision",
  } as const satisfies Intl.NumberFormatOptions;
  const compactNumber = new Intl.NumberFormat(locale, compactOptions);
  const percent = new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 0 });
  const day = new Intl.DateTimeFormat(locale, { day: "2-digit", month: "2-digit", timeZone });
  const month = new Intl.DateTimeFormat(locale, { month: "2-digit", year: "numeric", timeZone });
  const hour = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", timeZone });
  const dateTime = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  });
  const medium = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone });
  const formatMinor = (amountMinor: number, currency: string, fractionDigits?: number): string =>
    formatMoney(amountMinor, currency, locale, fractionDigits);
  return {
    timeZone,
    formatMedium: (atMs) => medium.format(atMs),
    formatMinor,
    formatRelative,
    formatPanelValue: (valueFormat) =>
      valueFormat === undefined
        ? (value) => number.format(value)
        : (value) => formatMinor(value, valueFormat.currency, valueFormat.fractionDigits),
    formatPanelAxisValue: (valueFormat) => {
      if (valueFormat === undefined || !CURRENCY_CODE_PATTERN.test(valueFormat.currency)) {
        return (value) => compactNumber.format(value);
      }
      const compactMoney = new Intl.NumberFormat(resolveSafeLocale(locale), {
        ...compactOptions,
        style: "currency",
        currency: valueFormat.currency,
      });
      const decimals = currencyDecimals(valueFormat.currency);
      return (value) => compactMoney.format(value / 10 ** decimals);
    },
    formatNumber: (value) => number.format(value),
    formatPercent: (fraction) => percent.format(fraction),
    formatDay: (atMs) => day.format(atMs),
    formatMonth: (atMs) => month.format(atMs),
    formatHour: (atMs) => hour.format(atMs),
    formatDateTime: (atMs) => dateTime.format(atMs),
  };
}

const MAX_TEXT_PARAM_DEPTH = 4;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDashboardI18nText(value: unknown): value is DashboardI18nText {
  return isRecord(value) && typeof value["i18nKey"] === "string";
}

function isMoneyParam(value: unknown): value is DashboardMoneyParam {
  return (
    isRecord(value) &&
    value["kind"] === "money" &&
    typeof value["amountMinor"] === "number" &&
    typeof value["currency"] === "string"
  );
}

function isDateParam(value: unknown): value is DashboardDateParam {
  return isRecord(value) && value["kind"] === "date" && typeof value["atMs"] === "number";
}

function isRelativeTimeParam(value: unknown): value is DashboardRelativeTimeParam {
  return isRecord(value) && value["kind"] === "relativeTime" && typeof value["atMs"] === "number";
}

function isTextParam(value: unknown): value is DashboardTextParam {
  return (
    typeof value === "string" ||
    typeof value === "number" ||
    isDashboardI18nText(value) ||
    isMoneyParam(value) ||
    isDateParam(value) ||
    isRelativeTimeParam(value)
  );
}

function resolveTextParam(
  param: unknown,
  translate: Translate,
  formats: DashboardFormats,
  depth: number,
): string | number {
  if (typeof param === "string" || typeof param === "number") return param;
  if (isMoneyParam(param)) return formats.formatMinor(param.amountMinor, param.currency);
  if (isDateParam(param)) return formats.formatMedium(param.atMs);
  if (isRelativeTimeParam(param)) return formats.formatRelative(param.atMs);
  if (isDashboardI18nText(param)) {
    // Too deep: show the key instead of recursing further.
    return depth >= MAX_TEXT_PARAM_DEPTH
      ? param.i18nKey
      : resolveI18nText(param, translate, formats, depth + 1);
  }
  return "";
}

function resolveI18nText(
  text: DashboardI18nText,
  translate: Translate,
  formats: DashboardFormats,
  depth: number,
): string {
  if (text.i18nParams === undefined) return translate(text.i18nKey);
  const params: Record<string, string | number> = {};
  for (const [name, param] of Object.entries(text.i18nParams)) {
    if (isTextParam(param)) params[name] = resolveTextParam(param, translate, formats, depth);
  }
  return translate(text.i18nKey, params);
}

/** Plain strings pass through; DashboardI18nText is translated (nested params first).
 *  Anything else yields undefined so callers fall back to their own placeholder. */
function resolveDashboardText(
  value: unknown,
  translate: Translate,
  formats: DashboardFormats,
): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (isDashboardI18nText(value)) return resolveI18nText(value, translate, formats, 1);
  return undefined;
}

function PanelShell({
  testId,
  title,
  subtitle,
  action,
  children,
}: {
  readonly testId: string;
  readonly title: string;
  readonly subtitle?: string;
  readonly action?: ReactNode;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <section
      data-testid={testId}
      className="flex h-full flex-col rounded-lg border border-border bg-card text-card-foreground"
    >
      <header className="flex min-h-11 shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border-row px-4 py-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 className="text-sm font-semibold break-words">{title}</h2>
          {subtitle !== undefined && <p className="text-xs text-muted-foreground">{subtitle}</p>}
        </div>
        {action !== undefined && <div className="shrink-0">{action}</div>}
      </header>
      <div className="grow p-4">{children}</div>
    </section>
  );
}

function PanelError({
  label,
  error,
  onRetry,
  testId,
}: {
  readonly label: string;
  readonly error: Parameters<typeof dispatcherErrorText>[0];
  readonly onRetry: () => void;
  readonly testId?: string;
}): ReactNode {
  const { Button } = usePrimitives();
  const t = useTranslation();
  return (
    <div
      role="alert"
      data-testid={testId}
      className="flex flex-col items-start gap-2 rounded-lg border border-dashed border-status-bad/40 px-4 py-6 text-sm"
    >
      <div className="font-medium text-status-bad">
        {t("kumiko.dashboard.panel.error.title", { label })}
      </div>
      <div className="text-muted-foreground">{dispatcherErrorText(error, t)}</div>
      <Button variant="secondary" onClick={onRetry}>
        {t("kumiko.dashboard.panel.error.retry")}
      </Button>
      <div className="text-xs text-muted-foreground">
        {t("kumiko.dashboard.panel.error.isolated")}
      </div>
    </div>
  );
}

type SkeletonShape = "bars" | "segments" | "rows";

function PanelSkeleton({ shape }: { readonly shape: SkeletonShape }): ReactNode {
  const t = useTranslation();
  if (shape === "rows") return <LoadingState rows={3} />;
  if (shape === "segments") {
    return (
      <output aria-label={t("kumiko.widget.loading")} className="flex flex-col gap-4">
        {SKELETON_SEGMENT_WIDTHS.map((width) => (
          <div key={width} className="flex flex-col gap-1.5">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-2.5 rounded-full" style={{ width }} />
          </div>
        ))}
      </output>
    );
  }
  return (
    <output aria-label={t("kumiko.widget.loading")} className="flex h-40 items-end gap-1">
      {SKELETON_BAR_HEIGHTS.map((height) => (
        <Skeleton key={height} className="flex-1" style={{ height }} />
      ))}
    </output>
  );
}

type QueryPanelProps<TData> = {
  readonly panel: DashboardPanelQueryOptions &
    DashboardPanelEmptyState & { readonly id: string; readonly query: string };
  readonly label: string;
  readonly subtitle?: string;
  readonly action?: ReactNode;
  readonly screenParams: ScreenParams;
  readonly translate: Translate;
  readonly skeleton: SkeletonShape;
  readonly isEmpty: (data: TData) => boolean;
  /** Receives the formats of the panel itself, so a relative time inside the body
   *  redraws this panel and nothing else. */
  readonly children: (data: TData, formats: DashboardFormats) => ReactNode;
};

function QueryPanel<TData>({
  panel,
  label,
  subtitle,
  action,
  screenParams,
  translate,
  skeleton,
  isEmpty,
  children,
}: QueryPanelProps<TData>): ReactNode {
  const formats = useDashboardFormats();
  const { data, error, loading, refetch } = useDashboardQuery<TData>(
    panel.query,
    panelPayload(panel, screenParams),
  );
  useReportPanelLoaded(data);
  let body: ReactNode;
  if (loading && data === null) {
    body = <PanelSkeleton shape={skeleton} />;
  } else if (error !== null) {
    body = <PanelError label={label} error={error} onRetry={() => void refetch()} />;
  } else if (data === null || isEmpty(data)) {
    body = (
      <EmptyState
        title={translate(panel.emptyLabel ?? "kumiko.list.no-entries")}
        description={panel.emptyHint !== undefined ? translate(panel.emptyHint) : undefined}
      />
    );
  } else {
    body = children(data, formats);
  }
  return (
    <PanelShell
      testId={`dashboard-panel-${panel.id}`}
      title={label}
      subtitle={subtitle}
      action={action}
    >
      {body}
    </PanelShell>
  );
}

function isSparkPoint(
  value: unknown,
): value is { readonly atMs: number; readonly value: number | null } {
  return (
    typeof value === "object" &&
    value !== null &&
    "value" in value &&
    (typeof value.value === "number" || value.value === null)
  );
}

function readSparkline(
  panel: DashboardStatPanel,
  record: Readonly<Record<string, unknown>>,
): readonly number[] | undefined {
  if (panel.sparklineField === undefined) return undefined;
  const raw = record[panel.sparklineField];
  if (!Array.isArray(raw)) return undefined;
  return raw.filter(isSparkPoint).flatMap((p) => (p.value === null ? [] : [p.value]));
}

function readTone(raw: unknown): StatTone | undefined {
  return isOneOf(DASHBOARD_STAT_TONES, raw) ? raw : undefined;
}

function fallbackText<T extends string | undefined>(raw: unknown, placeholder: T): string | T {
  if (raw === undefined || raw === null || isRecord(raw)) return placeholder;
  return String(raw);
}

function StatPanelBody({
  panel,
  label,
  screenId,
  screenParams,
  translate,
  variant,
}: {
  readonly panel: DashboardStatPanel;
  readonly label: string;
  readonly screenId: string;
  readonly screenParams: ScreenParams;
  readonly translate: Translate;
  readonly variant: "card" | "strip";
}): ReactNode {
  const formats = useDashboardFormats();
  // Resolved HERE (not in a separate always-rendered child) so `icon` on
  // <StatCard> is `undefined` — not a React element that renders empty —
  // when the icon name isn't registered. StatCard gates its accent chip on
  // `icon !== undefined`, so a resolved-but-hidden element used to leave a
  // stray accent-colored chip next to the label.
  const iconName = panel.icon !== undefined ? extensionSectionName(panel.icon) : undefined;
  const Icon = useExtensionSectionComponent(iconName);
  useEffect(() => {
    if (panel.icon !== undefined && iconName !== undefined && Icon === undefined) {
      // biome-ignore lint/suspicious/noConsole: dev-warning für Setup-Fehler
      console.warn(
        `[kumiko] Dashboard stat-panel "${panel.id}" on screen "${screenId}" references icon ` +
          `"${iconName}", which is not registered in clientFeatures.extensionSectionComponents.`,
      );
    }
  }, [panel.icon, panel.id, iconName, Icon, screenId]);

  const { data, error, loading, refetch } = useDashboardQuery<Readonly<Record<string, unknown>>>(
    panel.query,
    panelPayload(panel, screenParams),
  );
  useReportPanelLoaded(data);
  if (loading && data === null) return <LoadingState rows={2} />;
  if (error !== null) {
    return <PanelError label={label} error={error} onRetry={() => void refetch()} />;
  }
  const record = data ?? {};
  const rawValue = record[panel.valueField];
  const tone =
    readTone(panel.toneField !== undefined ? record[panel.toneField] : undefined) ??
    // A fixed tone must not paint an all-clear "0" as an alarm.
    (rawValue === 0 ? undefined : panel.tone);
  const sub = panel.subField !== undefined ? record[panel.subField] : undefined;
  const delta = readDelta(panel, record);
  const valueFormat = panel.valueFormat;
  let value: string;
  if (typeof rawValue !== "number") {
    value =
      resolveDashboardText(rawValue, translate, formats) ??
      fallbackText(rawValue, EMPTY_VALUE_PLACEHOLDER);
  } else if (valueFormat?.kind === "relativeTime") {
    value = formats.formatRelative(rawValue);
  } else {
    value = formats.formatPanelValue(valueFormat)(rawValue);
  }
  const spark = readSparkline(panel, record);
  const testId = `dashboard-panel-${panel.id}`;
  const subText = resolveDashboardText(sub, translate, formats) ?? fallbackText(sub, undefined);
  const icon =
    Icon !== undefined ? (
      <Icon
        entityName={screenId}
        entityId={null}
        screenId={screenId}
        filterParams={screenParams.filterParams}
      />
    ) : undefined;

  if (variant === "strip") {
    return (
      <StatStripCell
        icon={icon}
        label={label}
        value={value}
        tone={tone ?? "default"}
        {...(Icon !== undefined && { accentColor: panel.accentColor })}
        {...(subText !== undefined && { sub: subText })}
        {...(delta !== undefined && { delta })}
        {...(spark !== undefined && { spark })}
        testId={testId}
      />
    );
  }
  return (
    <StatCard
      icon={icon}
      label={label}
      value={value}
      tone={tone ?? "default"}
      {...(Icon !== undefined && { accentColor: panel.accentColor })}
      {...(subText !== undefined && { sub: subText })}
      {...(delta !== undefined && { delta })}
      {...(spark !== undefined && { spark })}
      testId={testId}
    />
  );
}

function readDelta(
  panel: DashboardStatPanel,
  record: Readonly<Record<string, unknown>>,
): StatDelta | undefined {
  if (panel.deltaField === undefined || panel.deltaDirectionField === undefined) return undefined;
  const value = record[panel.deltaField];
  const direction = record[panel.deltaDirectionField];
  if (value === undefined || value === null) return undefined;
  if (direction !== "up" && direction !== "down") return undefined;
  const tone = readTone(
    panel.deltaToneField !== undefined ? record[panel.deltaToneField] : undefined,
  );
  return { value: String(value), direction, ...(tone !== undefined && { tone }) };
}

function StatGroupPanelBody({
  panel,
  label,
  screenId,
  screenParams,
  translate,
}: {
  readonly panel: DashboardStatGroupPanel;
  readonly label: string | undefined;
  readonly screenId: string;
  readonly screenParams: ScreenParams;
  readonly translate: Translate;
}): ReactNode {
  const testId = `dashboard-panel-${panel.id}`;
  if (label === undefined) {
    return (
      <div
        data-testid={testId}
        className="grid grid-cols-2 gap-y-2 rounded-lg border border-border bg-card py-1 lg:auto-cols-fr lg:grid-flow-col lg:divide-x lg:divide-border-row"
      >
        {panel.stats.map((stat) => (
          <StatPanelBody
            key={stat.id}
            panel={stat}
            label={translate(stat.label)}
            screenId={screenId}
            screenParams={screenParams}
            translate={translate}
            variant="strip"
          />
        ))}
      </div>
    );
  }
  return (
    <SectionCard
      title={label}
      {...(panel.subtitle !== undefined && { subtitle: translate(panel.subtitle) })}
      testId={testId}
    >
      <section className="grid grid-cols-[repeat(auto-fit,minmax(min(12rem,100%),1fr))] gap-3">
        {panel.stats.map((stat) => (
          <StatPanelBody
            key={stat.id}
            panel={stat}
            label={translate(stat.label)}
            screenId={screenId}
            screenParams={screenParams}
            translate={translate}
            variant="card"
          />
        ))}
      </section>
    </SectionCard>
  );
}

type MarkerEnvelope = { readonly atMs: number; readonly label: unknown; readonly kind?: unknown };

function markerKindColor(kind: DashboardChartMarkerKind | undefined): string | undefined {
  if (kind === undefined) return undefined;
  if (kind.color !== undefined) return kind.color;
  return kind.tone !== undefined ? chartToneColor(kind.tone) : undefined;
}

function resolveMarkers(
  markers: readonly MarkerEnvelope[] | undefined,
  translate: Translate,
  formats: DashboardFormats,
  markerKinds?: Readonly<Record<string, DashboardChartMarkerKind>>,
): readonly ChartMarker[] | undefined {
  return markers?.map((marker) => {
    const color =
      typeof marker.kind === "string" ? markerKindColor(markerKinds?.[marker.kind]) : undefined;
    const legendKey =
      typeof marker.kind === "string" ? markerKinds?.[marker.kind]?.label : undefined;
    const legendLabel = legendKey !== undefined ? translate(legendKey) : undefined;
    return {
      atMs: marker.atMs,
      label: resolveDashboardText(marker.label, translate, formats) ?? "",
      ...(color !== undefined && { color }),
      ...(legendLabel !== undefined && { legendLabel }),
    };
  });
}

type SeriesEnvelope = {
  readonly key: string;
  readonly label: string;
  readonly points: readonly TimeseriesPoint[];
};

type LineEnvelope = SeriesEnvelope & { readonly dashed?: boolean };

type ChartEnvelope = {
  readonly points?: readonly TimeseriesPoint[];
  readonly series?: readonly SeriesEnvelope[];
  readonly rows?: readonly SegmentBarRow[];
  readonly windowStartMs?: number | null;
  readonly windowEndMs?: number | null;
  readonly todayMs?: number | null;
  readonly markers?: readonly MarkerEnvelope[];
  readonly lines?: readonly LineEnvelope[];
};

// A plain bar chart ("changes per day") ships `points` without `series`.
const SINGLE_SERIES_KEY = "value";

function chartSeries(
  data: ChartEnvelope,
  panelLabel: string,
  translate: Translate,
): readonly ChartSeries[] {
  if (data.series !== undefined && data.series.length > 0) {
    return data.series.map((s) => ({ ...s, label: translate(s.label) }));
  }
  if (data.points !== undefined && data.points.length > 0) {
    return [{ key: SINGLE_SERIES_KEY, label: panelLabel, points: data.points }];
  }
  return [];
}

function distinctBucketCount(series: readonly ChartSeries[]): number {
  return new Set(series.flatMap((s) => s.points.map((p) => p.atMs))).size;
}

function isChartEmpty(
  chart: DashboardChartPanel["chart"],
  data: ChartEnvelope,
  series: readonly ChartSeries[],
): boolean {
  if (chart === "segment-bars") return (data.rows ?? []).length === 0;
  if (chart === "stacked-bars") return distinctBucketCount(series) === 0;
  if (chart === "stacked-area") return distinctBucketCount(series) < 2;
  const measured = (data.points ?? []).filter((p) => p.value !== null);
  return measured.length < 2;
}

function windowOf(
  data: ChartEnvelope,
  series: readonly ChartSeries[],
): { readonly startMs: number; readonly endMs: number } {
  const times = series.flatMap((s) => s.points.map((p) => p.atMs));
  const startMs = data.windowStartMs ?? (times.length > 0 ? Math.min(...times) : 0);
  const endMs = data.windowEndMs ?? (times.length > 0 ? Math.max(...times) : 1);
  return { startMs, endMs };
}

function ChartPanelBody({
  panel,
  label,
  screenParams,
  translate,
}: {
  readonly panel: DashboardChartPanel;
  readonly label: string;
  readonly screenParams: ScreenParams;
  readonly translate: Translate;
}): ReactNode {
  const t = useTranslation();
  const todayLabel = t("kumiko.dashboard.today");
  const tones = panel.seriesTones;
  const colors = panel.seriesColors;
  const testId = `dashboard-chart-${panel.id}`;
  const ranges: StackedAreaRanges | undefined =
    panel.chart === "stacked-area" && panel.ranges !== undefined
      ? {
          default: panel.ranges.default,
          options: panel.ranges.options.map((option) => ({
            ...option,
            label: translate(option.label),
          })),
        }
      : undefined;
  const [windowSelection, setWindowSelection] = useState(() =>
    initialWindowSelection(
      ranges,
      panel.chart === "stacked-area" ? panel.initialWindow : undefined,
    ),
  );
  const rangeSwitch =
    ranges !== undefined ? (
      <ModeSwitch
        value={windowSelection?.kind === "range" ? windowSelection.value : null}
        options={ranges.options.map((option) => ({
          value: option.value,
          label: option.label,
        }))}
        onChange={(value) => setWindowSelection({ kind: "range", value })}
        ariaLabel={label}
        variant="pill"
        testId={`dashboard-chart-range-${panel.id}`}
      />
    ) : undefined;
  return (
    <QueryPanel<ChartEnvelope>
      panel={panel}
      label={label}
      subtitle={panel.subtitle !== undefined ? translate(panel.subtitle) : undefined}
      action={rangeSwitch}
      screenParams={screenParams}
      translate={translate}
      skeleton={panel.chart === "segment-bars" ? "segments" : "bars"}
      isEmpty={(data) => isChartEmpty(panel.chart, data, chartSeries(data, label, translate))}
    >
      {(data, formats) => {
        const series = chartSeries(data, label, translate);
        const { startMs, endMs } = windowOf(data, series);
        const markers = resolveMarkers(data.markers, translate, formats, panel.markerKinds);
        const formatValue = formats.formatPanelValue(panel.valueFormat);
        if (panel.chart === "segment-bars") {
          return (
            <SegmentBarChart
              rows={(data.rows ?? []).map((row) => ({
                ...row,
                label: translate(row.label),
                segments: row.segments.map((seg) => ({ ...seg, label: translate(seg.label) })),
              }))}
              tones={tones}
              colors={colors}
              ariaLabel={label}
              formatValue={formatValue}
              testId={testId}
            />
          );
        }
        if (panel.chart === "stacked-bars") {
          const times = series.flatMap((s) => s.points.map((p) => p.atMs));
          const spacing = Math.min(
            ...[...new Set(times)]
              .sort((a, b) => a - b)
              .flatMap((atMs, i, all) => {
                const prev = all[i - 1];
                return prev === undefined ? [] : [atMs - prev];
              }),
            DAY_MS,
          );
          return (
            <StackedBarChart
              series={series}
              windowEndMs={endMs}
              tones={tones}
              colors={colors}
              ariaLabel={label}
              todayLabel={todayLabel}
              formatBucketLabel={
                spacing < DAY_MS - HOUR_MS ? formats.formatHour : formats.formatDay
              }
              formatValue={formatValue}
              formatAxisValue={formats.formatPanelAxisValue(panel.valueFormat)}
              testId={testId}
            />
          );
        }
        if (panel.chart === "stacked-area") {
          const lines: readonly ChartLine[] = (data.lines ?? []).map((line) => ({
            ...line,
            label: translate(line.label),
          }));
          const todayMs = data.todayMs ?? undefined;
          const formatDateByFormat = (atMs: number, format: StackedAreaDateFormat): string =>
            format === "month" ? formats.formatMonth(atMs) : formats.formatDay(atMs);
          return (
            <StackedAreaChart
              series={series}
              lines={lines}
              windowStartMs={startMs}
              windowEndMs={endMs}
              {...(todayMs !== undefined && { todayMs })}
              tones={tones}
              colors={colors}
              markers={markers}
              {...(ranges !== undefined && { ranges })}
              brush={panel.brush === true}
              windowSelection={windowSelection}
              onWindowSelectionChange={setWindowSelection}
              brushLabels={{
                start: t("kumiko.dashboard.brush-start"),
                end: t("kumiko.dashboard.brush-end"),
              }}
              ariaLabel={label}
              todayLabel={todayLabel}
              formatBucketLabel={formatDateByFormat}
              formatValue={formatValue}
              formatAxisValue={formats.formatPanelAxisValue(panel.valueFormat)}
              markerLabels={panel.markerLabels === true}
              formatMarkerTime={formatDateByFormat}
              timeZone={formats.timeZone}
              {...(panel.dateFormat !== undefined && { dateFormat: panel.dateFormat })}
              {...(panel.markerLegend !== undefined && { markerLegend: panel.markerLegend })}
              scrollable={panel.scrollable === true}
              showLegendTotals={panel.legendTotals !== false}
              emptyContent={
                <EmptyState title={translate(panel.emptyLabel ?? "kumiko.list.no-entries")} />
              }
              testId={testId}
            />
          );
        }
        return (
          <TimeseriesChart
            points={data.points ?? []}
            windowStartMs={startMs}
            windowEndMs={endMs}
            markers={markers}
            formatMarkerTime={formats.formatDay}
            {...((panel.valueFormat !== undefined || panel.unit !== undefined) && {
              yAxis: {
                ticks: 3,
                format: formats.formatPanelAxisValue(panel.valueFormat),
                ...(panel.unit !== undefined && { unit: translate(panel.unit) }),
              },
            })}
            ariaLabel={label}
            testId={testId}
          />
        );
      }}
    </QueryPanel>
  );
}

type ListEnvelope = { readonly rows?: readonly Readonly<Record<string, unknown>>[] };

function ListPanelBody({
  panel,
  label,
  screenParams,
  translate,
}: {
  readonly panel: DashboardListPanel;
  readonly label: string;
  readonly screenParams: ScreenParams;
  readonly translate: Translate;
}): ReactNode {
  const { formatPercent, formatNumber, formatDateTime } = useDashboardFormats();
  const columns = panel.columns.map((c) => {
    const normalized = normalizeListColumn(c);
    return {
      field: normalized.field,
      label: translate(normalized.label ?? normalized.field),
      ...(normalized.display !== undefined && { display: normalized.display }),
      ...(normalized.badgeToneField !== undefined && {
        badgeToneField: normalized.badgeToneField,
      }),
    };
  });
  return (
    <QueryPanel<ListEnvelope>
      panel={panel}
      label={label}
      screenParams={screenParams}
      translate={translate}
      skeleton="rows"
      isEmpty={(data) => (data.rows ?? []).length === 0}
    >
      {(data) => (
        <DashboardListTable
          columns={columns}
          rows={data.rows ?? []}
          formatPercent={formatPercent}
          formatNumber={formatNumber}
          formatDateTime={formatDateTime}
          translate={translate}
        />
      )}
    </QueryPanel>
  );
}

type FeedEnvelope = {
  readonly rows?: readonly { readonly primary: unknown; readonly trailing?: unknown }[];
};

function FeedPanelBody({
  panel,
  label,
  screenParams,
  translate,
}: {
  readonly panel: DashboardFeedPanel;
  readonly label: string;
  readonly screenParams: ScreenParams;
  readonly translate: Translate;
}): ReactNode {
  return (
    <QueryPanel<FeedEnvelope>
      panel={panel}
      label={label}
      screenParams={screenParams}
      translate={translate}
      skeleton="rows"
      isEmpty={(data) => (data.rows ?? []).length === 0}
    >
      {(data, formats) => {
        const rows: readonly FeedRow[] = (data.rows ?? []).map((row, i) => {
          const trailing = resolveDashboardText(row.trailing, translate, formats);
          return {
            id: String(i),
            primary:
              resolveDashboardText(row.primary, translate, formats) ?? EMPTY_VALUE_PLACEHOLDER,
            ...(trailing !== undefined && { trailing }),
          };
        });
        return <FeedList rows={rows} />;
      }}
    </QueryPanel>
  );
}

type ProgressListEnvelope = {
  readonly rows?: readonly Readonly<Record<string, unknown>>[];
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isProgressTone(value: unknown): value is DashboardProgressTone {
  return value === "default" || value === "danger";
}

type ProgressUsage = { readonly used: number; readonly limit: number | null };

function progressUsageOf(row: Readonly<Record<string, unknown>>): ProgressUsage | undefined {
  const { used, limit } = row;
  if (!isFiniteNumber(used)) return undefined;
  if (limit === null) return { used, limit: null };
  return isFiniteNumber(limit) ? { used, limit } : undefined;
}

function toProgressListRow(
  row: Readonly<Record<string, unknown>>,
  index: number,
  translate: Translate,
  formats: DashboardFormats,
): ProgressListRow {
  const sub = resolveDashboardText(row["sub"], translate, formats);
  const usage = progressUsageOf(row);
  const explicitTone = isProgressTone(row["tone"]) ? row["tone"] : undefined;
  const common = {
    id: String(index),
    label: resolveDashboardText(row["label"], translate, formats) ?? EMPTY_VALUE_PLACEHOLDER,
    ...(sub !== undefined && { sub }),
  };
  if (usage === undefined) {
    return {
      ...common,
      value: resolveDashboardText(row["value"], translate, formats) ?? EMPTY_VALUE_PLACEHOLDER,
      fraction: isFiniteNumber(row["fraction"]) ? row["fraction"] : 0,
      ...(explicitTone !== undefined && { tone: explicitTone }),
    };
  }
  const { used, limit } = usage;
  const usedText = formats.formatNumber(used);
  const limitText =
    limit === null ? translate("kumiko.dashboard.progress.unlimited") : formats.formatNumber(limit);
  const exhausted = limit !== null && used >= limit;
  const tone = explicitTone ?? (exhausted ? "danger" : undefined);
  let fraction: number | null = null;
  if (limit !== null) fraction = limit === 0 ? 1 : used / limit;
  return {
    ...common,
    value: `${usedText} / ${limitText}`,
    fraction,
    ...(tone !== undefined && { tone }),
  };
}

function ProgressListPanelBody({
  panel,
  label,
  screenParams,
  translate,
}: {
  readonly panel: DashboardProgressListPanel;
  readonly label: string;
  readonly screenParams: ScreenParams;
  readonly translate: Translate;
}): ReactNode {
  return (
    <QueryPanel<ProgressListEnvelope>
      panel={panel}
      label={label}
      screenParams={screenParams}
      translate={translate}
      skeleton="rows"
      isEmpty={(data) => (data.rows ?? []).length === 0}
    >
      {(data, formats) => {
        const rows = (data.rows ?? []).map((row, i) =>
          toProgressListRow(row, i, translate, formats),
        );
        return <ProgressList rows={rows} />;
      }}
    </QueryPanel>
  );
}

function TextBlockView({
  block,
  translate,
}: {
  readonly block: DashboardTextBlock;
  readonly translate: Translate;
}): ReactNode {
  switch (block.kind) {
    case "heading":
      return (
        <h3 data-block="heading" className="text-sm font-semibold text-foreground">
          {translate(block.text)}
        </h3>
      );
    case "paragraph":
      return (
        <p
          data-block="paragraph"
          className={
            block.emphasis === "strong"
              ? "text-sm font-medium text-foreground"
              : "text-sm text-muted-foreground"
          }
        >
          {translate(block.text)}
        </p>
      );
    case "list":
      return (
        <ul data-block="list" className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          {block.items.map((item) => (
            <li key={item}>{translate(item)}</li>
          ))}
        </ul>
      );
    case "code":
      return (
        <pre data-block="code" className="overflow-x-auto rounded-md bg-muted p-3 text-xs">
          <code>{block.code}</code>
        </pre>
      );
    case "hint":
      return (
        <p data-block="hint" className="text-xs text-muted-foreground">
          {translate(block.text)}
        </p>
      );
  }
}

function textBlockKey(block: DashboardTextBlock): string {
  switch (block.kind) {
    case "list":
      return `list:${block.items.join("|")}`;
    case "code":
      return `code:${block.code}`;
    default:
      return `${block.kind}:${block.text}`;
  }
}

function TextPanelBody({
  panel,
  label,
  translate,
}: {
  readonly panel: DashboardTextPanel;
  readonly label: string | undefined;
  readonly translate: Translate;
}): ReactNode {
  const blocks = (
    <div className="flex flex-col gap-3">
      {panel.blocks.map((block) => (
        <TextBlockView key={textBlockKey(block)} block={block} translate={translate} />
      ))}
    </div>
  );
  const testId = `dashboard-panel-${panel.id}`;
  if (label !== undefined) {
    return (
      <PanelShell testId={testId} title={label}>
        {blocks}
      </PanelShell>
    );
  }
  return (
    <section
      data-testid={testId}
      className="h-full rounded-lg border border-border bg-card p-4 text-card-foreground"
    >
      {blocks}
    </section>
  );
}

// Löst panel.component über dieselbe extensionSectionComponents-Registry auf
// wie entityEdit-Extension-Sections und List-Header-Slots — bleibt an seiner
// Array-Position statt in einen separaten Slot zu wandern (siehe Datei-Kopf-
// Kommentar zur Registry). Rendert nichts + dev-Warnung bei unregistriertem
// Namen, analog zu ListHeaderSlotMount in render-list.tsx.
function CustomPanelBody({
  panel,
  screenId,
  filterParams,
}: {
  readonly panel: DashboardCustomPanel;
  readonly screenId: string;
  readonly filterParams: Readonly<Record<string, unknown>>;
}): ReactNode {
  const name = extensionSectionName(panel.component);
  const Component = useExtensionSectionComponent(name);
  useEffect(() => {
    if (name !== undefined && Component === undefined) {
      // biome-ignore lint/suspicious/noConsole: dev-warning für Setup-Fehler
      console.warn(
        `[kumiko] Dashboard custom-panel "${panel.id}" on screen "${screenId}" references component ` +
          `"${name}", which is not registered in clientFeatures.extensionSectionComponents — the panel renders nothing.`,
      );
    }
  }, [name, Component, panel.id, screenId]);
  if (Component === undefined) return null;
  // Dashboard-Panels haben keine Entity — entityName trägt die screen.id,
  // damit ExtensionSectionProps nicht extra für diesen einen Mount-Ort
  // aufgeweicht werden muss (das bräche jede bestehende registrierte
  // Section, die entityName als garantiert gesetzten string erwartet).
  return (
    <Component
      entityName={screenId}
      entityId={null}
      screenId={screenId}
      filterParams={filterParams}
    />
  );
}

// Value lives in the URL under `filter.id` (like useListUrlState's
// `<screenId>.page`, same replaceState) so a `navigate` rowAction with
// `params` can deep-link onto this filter.
function useFilterParams(
  screen: DashboardScreenDefinition,
  enabled: boolean,
): {
  readonly params: Readonly<Record<string, unknown>>;
  readonly picker: ReactNode;
} {
  const { Field, Input } = usePrimitives();
  const t = useTranslation();
  const nav = useNav();
  const filter = screen.filter;
  const value = filter !== undefined ? (nav.searchParams[filter.id] ?? "") : "";
  const optionsQueryResult = useQuery<{
    readonly rows: readonly { readonly value: string; readonly label: string }[];
  }>(filter?.optionsQuery ?? "", {}, { enabled: enabled && filter?.optionsQuery !== undefined });

  if (filter === undefined) {
    return { params: {}, picker: null };
  }

  const dynamicOptions =
    filter.optionsQuery !== undefined
      ? (optionsQueryResult.data?.rows ?? [])
      : (filter.options ?? []).map((o) => ({ value: o.value, label: t(o.label) }));
  const allLabel = t(filter.allLabel ?? "kumiko.dashboard.filter.all");
  const options = [{ value: "", label: allLabel }, ...dynamicOptions];

  const picker = (
    <div className="max-w-xs">
      <Field id={`dashboard-filter-${filter.id}`} label={t(filter.label)}>
        <Input
          kind="combobox"
          id={`dashboard-filter-${filter.id}`}
          name={filter.id}
          options={options}
          value={value}
          onChange={(next: string) =>
            nav.setSearchParams({ [filter.id]: next === "" ? null : next })
          }
          placeholder={filter.placeholder !== undefined ? t(filter.placeholder) : allLabel}
        />
      </Field>
    </div>
  );
  const params = value === "" ? {} : { [filter.id]: value };
  return { params, picker };
}

// An unknown/stale URL value falls back to the declared default.
function useTimeRange(
  screen: DashboardScreenDefinition,
  translate: Translate,
): { readonly params: Readonly<Record<string, unknown>>; readonly control: ReactNode } {
  const t = useTranslation();
  const nav = useNav();
  const resolver = useLocale();
  const timeRange = screen.timeRange;
  if (timeRange === undefined) return { params: {}, control: null };
  const fromUrl = nav.searchParams[timeRange.id];
  const value = timeRange.options.find((o) => o.value === fromUrl)?.value ?? timeRange.default;
  return {
    // Metric buckets are cut server-side; without the user's zone they default
    // to UTC while the axis labels are formatted in the user's zone.
    params: { [timeRange.id]: value, timeZone: resolver.timeZone() },
    control: (
      <ModeSwitch
        value={value}
        options={timeRange.options.map((o) => ({ value: o.value, label: translate(o.label) }))}
        onChange={(next) => nav.setSearchParams({ [timeRange.id]: next })}
        ariaLabel={t("kumiko.dashboard.time-range")}
        testId={`dashboard-time-range-${timeRange.id}`}
      />
    ),
  };
}

function panelSpanClassName(panel: DashboardPanelDefinition): string | undefined {
  if (panel.kind === "stat") return undefined;
  if ("span" in panel && panel.span !== undefined)
    return panel.span === "half" ? HALF_PANEL : WIDE_PANEL;
  if (panel.kind === "feed" || panel.kind === "progress-list") return HALF_PANEL;
  return WIDE_PANEL;
}

function PanelBody({
  panel,
  label,
  screenId,
  screenParams,
  translate,
}: {
  readonly panel: Exclude<DashboardPanelDefinition, DashboardScreenPanel>;
  readonly label: string | undefined;
  readonly screenId: string;
  readonly screenParams: ScreenParams;
  readonly translate: Translate;
}): ReactNode {
  if (panel.kind === "stat-group") {
    return (
      <StatGroupPanelBody
        panel={panel}
        label={label}
        screenId={screenId}
        screenParams={screenParams}
        translate={translate}
      />
    );
  }
  if (panel.kind === "custom") {
    return (
      <CustomPanelBody
        panel={panel}
        screenId={screenId}
        filterParams={{
          ...screenParams.filterParams,
          ...screenParams.rangeParams,
          ...screenParams.recordParams,
        }}
      />
    );
  }
  const text = label ?? "";
  if (panel.kind === "stat") {
    return (
      <StatPanelBody
        panel={panel}
        label={text}
        screenId={screenId}
        screenParams={screenParams}
        translate={translate}
        variant="card"
      />
    );
  }
  if (panel.kind === "chart") {
    return (
      <ChartPanelBody
        panel={panel}
        label={text}
        screenParams={screenParams}
        translate={translate}
      />
    );
  }
  if (panel.kind === "list") {
    return (
      <ListPanelBody panel={panel} label={text} screenParams={screenParams} translate={translate} />
    );
  }
  if (panel.kind === "feed") {
    return (
      <FeedPanelBody panel={panel} label={text} screenParams={screenParams} translate={translate} />
    );
  }
  if (panel.kind === "text") {
    return <TextPanelBody panel={panel} label={label} translate={translate} />;
  }
  return (
    <ProgressListPanelBody
      panel={panel}
      label={text}
      screenParams={screenParams}
      translate={translate}
    />
  );
}

type VisibilityQueryResult = UseQueryResult<Readonly<Record<string, unknown>>>;
type VisibilityQueryResults = ReadonlyMap<string, VisibilityQueryResult>;

const VisibilityQueryContext = createContext<VisibilityQueryResults>(new Map());

type VisibilityGate = {
  readonly key: string;
  readonly query: string;
  readonly payload: Readonly<Record<string, unknown>>;
};

const NO_GATE_PAYLOAD: Readonly<Record<string, unknown>> = {};

function visibilityGate(query: string, payload: Readonly<Record<string, unknown>>): VisibilityGate {
  return { key: `${query}|${JSON.stringify(payload)}`, query, payload };
}

// Embedded screens carry no screen filter; in-grid panels pass the filter
// (unless ignoreScreenFilter, never for a stat-group) and the time range.
function panelVisibilityGate(
  panel: DashboardPanelDefinition,
  screenParams: ScreenParams,
): VisibilityGate | undefined {
  if (panel.kind === "custom" || panel.visibleWhen === undefined) return undefined;
  if (panel.kind === "screen") return visibilityGate(panel.visibleWhen.query, NO_GATE_PAYLOAD);
  const dropsFilter =
    panel.kind !== "stat-group" && panel.kind !== "text" && panel.ignoreScreenFilter === true;
  return visibilityGate(panel.visibleWhen.query, {
    ...(dropsFilter ? {} : screenParams.filterParams),
    ...screenParams.rangeParams,
    ...screenParams.recordParams,
  });
}

// One live query per distinct gate (query + payload), shared by every panel
// that gates on it — N panels on the same status query would otherwise each
// open their own request, SSE subscription and refetch per event. The queries
// run as keyed siblings of the grid so a changing gate count never changes the
// grid's position in the tree (which would remount every panel).
function VisibilityGateQuery({
  gate,
  onResult,
  onForget,
}: {
  readonly gate: VisibilityGate;
  readonly onResult: (key: string, result: VisibilityQueryResult) => void;
  readonly onForget: (key: string) => void;
}): null {
  const { data, error, loading, refetch } = useDashboardQuery<Readonly<Record<string, unknown>>>(
    gate.query,
    gate.payload,
  );
  const { key } = gate;
  useEffect(() => {
    onResult(key, { data, error, loading, refetch });
  }, [key, data, error, loading, refetch, onResult]);
  useEffect(() => () => onForget(key), [key, onForget]);
  return null;
}

function VisibilityGateQueries({
  gates,
  onResult,
  onForget,
}: {
  readonly gates: readonly VisibilityGate[];
  readonly onResult: (key: string, result: VisibilityQueryResult) => void;
  readonly onForget: (key: string) => void;
}): ReactNode {
  return gates.map((gate) => (
    <VisibilityGateQuery key={gate.key} gate={gate} onResult={onResult} onForget={onForget} />
  ));
}

function useVisibilityGateResults(): {
  readonly results: VisibilityQueryResults;
  readonly report: (key: string, result: VisibilityQueryResult) => void;
  readonly forget: (key: string) => void;
} {
  const [results, setResults] = useState<VisibilityQueryResults>(new Map());
  const report = useCallback((key: string, result: VisibilityQueryResult) => {
    setResults((prev) => new Map(prev).set(key, result));
  }, []);
  const forget = useCallback((key: string) => {
    setResults((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Map(prev);
      next.delete(key);
      return next;
    });
  }, []);
  return { results, report, forget };
}

function distinctVisibilityGates(
  panels: readonly DashboardPanelDefinition[],
  screenParams: ScreenParams,
): VisibilityGate[] {
  const gates = new Map<string, VisibilityGate>();
  for (const panel of panels) {
    const gate = panelVisibilityGate(panel, screenParams);
    if (gate !== undefined) gates.set(gate.key, gate);
  }
  return [...gates.values()];
}

function GatedGridCell({
  panel,
  screenParams,
  label,
  className,
  children,
}: {
  readonly panel: Exclude<DashboardPanelDefinition, DashboardScreenPanel>;
  readonly screenParams: ScreenParams;
  readonly label: string;
  readonly className: string | undefined;
  readonly children: ReactNode;
}): ReactNode {
  const gate = panelVisibilityGate(panel, screenParams);
  const visibility = useContext(VisibilityQueryContext).get(gate?.key ?? "");
  const visibleWhen = panel.kind === "custom" ? undefined : panel.visibleWhen;
  if (visibleWhen !== undefined) {
    const verdict = evalVisibleWhen(visibleWhen, visibility);
    if (verdict === "error" && visibility?.error) {
      return (
        <div className={cn("min-w-0", className)} data-testid={`dashboard-panel-${panel.id}`}>
          <PanelError
            label={label}
            error={visibility.error}
            onRetry={() => void visibility.refetch()}
          />
        </div>
      );
    }
    // Loading renders nothing too: a skeleton that then vanishes flickers.
    if (verdict !== "visible") return null;
  }
  return <div className={cn("min-w-0", className)}>{children}</div>;
}

function EmbeddedScreenPanelTile({
  panel,
  target,
  translate,
}: {
  readonly panel: DashboardScreenPanel;
  readonly target: EmbeddedScreenTarget;
  readonly translate: Translate;
}): ReactNode {
  const screenBody = <KumikoScreen schema={target.schema} qn={target.qn} translate={translate} />;
  const embedded =
    panel.chromeless === true ? (
      <EmbeddedFormProvider>
        <EmbeddedScreenProvider>{screenBody}</EmbeddedScreenProvider>
      </EmbeddedFormProvider>
    ) : (
      screenBody
    );
  return (
    <div className={cn("min-w-0", WIDE_PANEL)} data-testid={`dashboard-panel-${panel.id}`}>
      {panel.label !== undefined && panel.chromeless !== true ? (
        <SectionCard title={translate(panel.label)}>{embedded}</SectionCard>
      ) : (
        <>
          {panel.label !== undefined && (
            <h3 className="mb-3 text-sm font-semibold text-foreground">{translate(panel.label)}</h3>
          )}
          {embedded}
        </>
      )}
    </div>
  );
}

// Own component so the target lookup (a hook) only runs for panels that actually fall back.
function FallbackScreenPanelTile({
  panel,
  fallback,
  featureName,
  translate,
}: {
  readonly panel: DashboardScreenPanel;
  readonly fallback: string;
  readonly featureName: string;
  readonly translate: Translate;
}): ReactNode {
  const target = useEmbeddedScreen(featureName, fallback);
  if (target === undefined) return null;
  return <EmbeddedScreenPanelTile panel={panel} target={target} translate={translate} />;
}

function ScreenPanelTile({
  panel,
  featureName,
  translate,
}: {
  readonly panel: DashboardScreenPanel;
  readonly featureName: string;
  readonly translate: Translate;
}): ReactNode {
  const visibleWhen = panel.visibleWhen;
  const visibility = useContext(VisibilityQueryContext).get(
    visibleWhen !== undefined ? visibilityGate(visibleWhen.query, NO_GATE_PAYLOAD).key : "",
  );
  const target = useEmbeddedScreen(featureName, panel.screen);
  const verdict = visibleWhen === undefined ? "visible" : evalVisibleWhen(visibleWhen, visibility);
  // Nothing while the gate loads: a fallback that flashes before the real panel flickers.
  if (verdict === "loading") return null;
  if (verdict !== "visible" && panel.fallback !== undefined) {
    return (
      <FallbackScreenPanelTile
        panel={panel}
        fallback={panel.fallback}
        featureName={featureName}
        translate={translate}
      />
    );
  }
  if (target === undefined) return null;
  // A failed gate query must not silently drop the panel: on the
  // account-security page that would hide every MFA enable/disable path.
  if (verdict === "error" && visibility?.error) {
    return (
      <div className={cn("min-w-0", WIDE_PANEL)} data-testid={`dashboard-panel-${panel.id}`}>
        <PanelError
          label={panel.label !== undefined ? translate(panel.label) : panel.id}
          error={visibility.error}
          onRetry={() => void visibility.refetch()}
        />
      </div>
    );
  }
  if (verdict !== "visible") return null;
  return <EmbeddedScreenPanelTile panel={panel} target={target} translate={translate} />;
}

// Starts at render time and restarts whenever the merged query params change;
// panels additionally report each successful (re)load, so live refetches and
// retries keep the stamp current.
function useLoadedAt(screenParams: ScreenParams): {
  readonly loadedAtMs: number;
  readonly reportLoaded: (atMs: number) => void;
} {
  const paramsKey = JSON.stringify([
    screenParams.filterParams,
    screenParams.rangeParams,
    screenParams.recordParams,
  ]);
  const [loaded, setLoaded] = useState(() => ({ paramsKey, atMs: Date.now() }));
  if (loaded.paramsKey !== paramsKey) setLoaded({ paramsKey, atMs: Date.now() });
  const reportLoaded = useCallback(
    (atMs: number) => setLoaded((prev) => (prev.atMs >= atMs ? prev : { ...prev, atMs })),
    [],
  );
  return { loadedAtMs: loaded.atMs, reportLoaded };
}

const PanelLoadedContext = createContext<(atMs: number) => void>(() => {});

function useReportPanelLoaded(data: unknown): void {
  const reportLoaded = useContext(PanelLoadedContext);
  useEffect(() => {
    if (data !== null) reportLoaded(Date.now());
  }, [data, reportLoaded]);
}

const NO_RECORD_ROW: Readonly<Record<string, unknown>> = {};

function recordTitleText(row: Readonly<Record<string, unknown>> | null, field: string | undefined) {
  if (row === null || field === undefined) return undefined;
  const value = row[field];
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  return String(value) === "" ? undefined : String(value);
}

export function WebDashboardBody({
  featureName,
  screen,
  translate,
}: DashboardBodyProps): ReactNode {
  const t = useTranslation();
  const effectiveTranslate = translate ?? t;
  const { Text, Banner, PageHeader, Heading, Button, Dialog, ActionOverflowMenu, Grid } =
    usePrimitives();
  const nav = useNav();
  const headerSlotAvailable = usePageHeaderSlotAvailable();
  const headerCompactContext = usePageHeaderCompact();
  const { formatDateTime } = useDashboardFormats();

  const recordBinding = screen.record;
  const recordId = recordBinding !== undefined ? (nav.searchParams[recordBinding.param] ?? "") : "";
  const recordMissing = recordBinding !== undefined && recordId === "";
  const recordPayloadKey = recordBinding?.payloadKey ?? recordBinding?.param;
  const recordParams: Readonly<Record<string, unknown>> =
    recordPayloadKey !== undefined && recordId !== "" ? { [recordPayloadKey]: recordId } : {};
  const recordQueryName = recordBinding?.query;

  const { params: filterParams, picker } = useFilterParams(screen, !recordMissing);
  const { params: rangeParams, control: rangeControl } = useTimeRange(screen, effectiveTranslate);
  const screenParams: ScreenParams = { filterParams, rangeParams, recordParams };
  const { loadedAtMs, reportLoaded } = useLoadedAt(screenParams);
  const visibilityGates = distinctVisibilityGates(screen.panels, screenParams);
  const gateResults = useVisibilityGateResults();

  // The record query is not a panel query: it needs the interval before the
  // registry context below exists, and `refresh.field` reads from its own row.
  const [refreshIntervalMs, setRefreshIntervalMs] = useState(() =>
    resolveRefreshIntervalMs(screen.refresh, null),
  );
  const recordQuery = useQuery<Readonly<Record<string, unknown>>>(
    recordQueryName ?? "",
    recordParams,
    {
      enabled: recordQueryName !== undefined && !recordMissing,
      live: true,
      ...(refreshIntervalMs !== undefined && { refetchIntervalMs: refreshIntervalMs }),
    },
  );
  const { data: recordRow, refetch: refetchRecord } = recordQuery;
  useEffect(() => {
    setRefreshIntervalMs(resolveRefreshIntervalMs(screen.refresh, recordRow));
  }, [screen.refresh, recordRow]);

  const { register, refetchRegistered } = useRefetchRegistry();
  const queryRuntime = useMemo(
    () => ({ refreshIntervalMs, register }),
    [refreshIntervalMs, register],
  );
  const refetchAll = useCallback(async () => {
    await Promise.all([
      recordQueryName !== undefined ? refetchRecord() : Promise.resolve(),
      refetchRegistered(),
    ]);
  }, [recordQueryName, refetchRecord, refetchRegistered]);

  const [actionError, setActionError] = useState<string | null>(null);
  const idOnlyRow = useMemo(
    () => (recordPayloadKey !== undefined ? { id: recordId, [recordPayloadKey]: recordId } : null),
    [recordId, recordPayloadKey],
  );
  const actionRow = recordQueryName !== undefined ? recordRow : idOnlyRow;
  const headerActions = useRecordActions({
    actions: actionRow !== null && !recordMissing ? screen.actions : undefined,
    record: actionRow ?? NO_RECORD_ROW,
    recordId,
    translate: effectiveTranslate,
    onWriteSuccess: refetchAll,
  });

  const scope = screen.scope;
  // A raw description is agent-facing prose; only an i18n key is user-facing copy.
  const translatedDescription =
    screen.description !== undefined ? effectiveTranslate(screen.description) : undefined;
  const description =
    translatedDescription !== screen.description ? translatedDescription : undefined;
  const scopeBadge =
    scope !== undefined ? (
      <StatusBadge tone="accent" testId={`dashboard-${screen.id}-scope`}>
        {effectiveTranslate(scope.badge)}
      </StatusBadge>
    ) : null;

  if (recordMissing) {
    return (
      <PageSection className="flex flex-col gap-4" testId={`dashboard-${screen.id}`}>
        <Banner variant="info" testId={`dashboard-${screen.id}-record-missing`}>
          {t("kumiko.dashboard.record.missing")}
        </Banner>
      </PageSection>
    );
  }

  const usesPageHeaderSlot = headerSlotAvailable && PageHeader !== undefined;
  const recordTitle = recordTitleText(recordRow, recordBinding?.titleField);
  const headerActionsBar =
    headerActions !== undefined && headerActions.length > 0 ? (
      <Grid columns="auto" testId={`dashboard-${screen.id}-actions`}>
        <HeaderActionsBar
          actions={headerActions}
          Button={Button}
          Dialog={Dialog}
          ActionOverflowMenu={ActionOverflowMenu}
          onError={setActionError}
          collapseAfterPrimary={usesPageHeaderSlot}
          compact={headerCompactContext && usesPageHeaderSlot}
          PageHeader={PageHeader}
          overflowTestId={`dashboard-${screen.id}-actions-overflow`}
        />
      </Grid>
    ) : null;
  // The shell header owns the title; the badge and the actions sit in it there.
  const badgeInHeader = scopeBadge !== null && usesPageHeaderSlot;
  const showPageHeader =
    usesPageHeaderSlot && (badgeInHeader || recordTitle !== undefined || headerActionsBar !== null);
  return (
    <PanelLoadedContext.Provider value={reportLoaded}>
      <DashboardQueryContext.Provider value={queryRuntime}>
        <PageSection className="flex flex-col gap-4" testId={`dashboard-${screen.id}`}>
          {showPageHeader && (
            <PageHeader
              {...(recordTitle !== undefined && { title: recordTitle })}
              {...(badgeInHeader && { status: scopeBadge })}
              {...(headerActionsBar !== null && { actions: headerActionsBar })}
            />
          )}
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              {!usesPageHeaderSlot && recordTitle !== undefined && (
                <Heading variant="page" testId={`dashboard-${screen.id}-record-title`}>
                  {recordTitle}
                </Heading>
              )}
              {!badgeInHeader && scopeBadge}
              {picker}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              {!usesPageHeaderSlot && headerActionsBar}
              {screen.showUpdatedAt !== false && (
                <span
                  data-testid={`dashboard-${screen.id}-updated-at`}
                  className="text-xs tabular-nums text-muted-foreground"
                >
                  {t("kumiko.dashboard.updated-at", { time: formatDateTime(loadedAtMs) })}
                </span>
              )}
              {rangeControl}
            </div>
          </div>
          {actionError !== null && (
            <Banner variant="error" testId="render-edit-action-error">
              {actionError}
            </Banner>
          )}
          {recordQuery.error !== null && recordRow === null && (
            <div
              role="alert"
              data-testid={`dashboard-${screen.id}-record-error`}
              className="flex flex-col items-start gap-2 text-sm"
            >
              <span className="text-status-bad">{dispatcherErrorText(recordQuery.error, t)}</span>
              <Button variant="secondary" onClick={() => void refetchRecord()}>
                {t("kumiko.dashboard.panel.error.retry")}
              </Button>
            </div>
          )}
          {description !== undefined && (
            <Text variant="muted" testId={`dashboard-${screen.id}-description`}>
              {description}
            </Text>
          )}
          {scope?.notice !== undefined && (
            <Banner variant="info" testId={`dashboard-${screen.id}-scope-notice`}>
              {effectiveTranslate(scope.notice)}
            </Banner>
          )}
          <VisibilityQueryContext.Provider value={gateResults.results}>
            <VisibilityGateQueries
              gates={visibilityGates}
              onResult={gateResults.report}
              onForget={gateResults.forget}
            />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {screen.panels.map((panel) => {
                if (panel.kind === "screen") {
                  return (
                    <ScreenPanelTile
                      key={panel.id}
                      panel={panel}
                      featureName={featureName}
                      translate={effectiveTranslate}
                    />
                  );
                }
                const label =
                  panel.kind === "custom" || panel.label === undefined
                    ? undefined
                    : effectiveTranslate(panel.label);
                return (
                  <GatedGridCell
                    key={panel.id}
                    panel={panel}
                    screenParams={screenParams}
                    label={label ?? panel.id}
                    className={panelSpanClassName(panel)}
                  >
                    <PanelBody
                      panel={panel}
                      label={label}
                      screenId={screen.id}
                      screenParams={screenParams}
                      translate={effectiveTranslate}
                    />
                  </GatedGridCell>
                );
              })}
            </div>
          </VisibilityQueryContext.Provider>
        </PageSection>
      </DashboardQueryContext.Provider>
    </PanelLoadedContext.Provider>
  );
}
