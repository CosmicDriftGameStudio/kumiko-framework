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

import type {
  DashboardChartMarkerKind,
  DashboardChartPanel,
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
  DashboardScreenDefinition,
  DashboardScreenPanel,
  DashboardStatGroupPanel,
  DashboardStatPanel,
  DashboardTextParam,
  DashboardValueFormat,
} from "@cosmicdrift/kumiko-framework/ui-types";
import { normalizeListColumn } from "@cosmicdrift/kumiko-framework/ui-types";
import type { Translate } from "@cosmicdrift/kumiko-headless";
import {
  type DashboardBodyProps,
  dispatcherErrorText,
  EmbeddedScreenProvider,
  evalVisibleWhen,
  extensionSectionName,
  KumikoScreen,
  type UseQueryResult,
  useEmbeddedScreen,
  useExtensionSectionComponent,
  useLocale,
  useNav,
  usePageHeaderSlotAvailable,
  usePrimitives,
  useQuery,
  useTranslation,
} from "@cosmicdrift/kumiko-renderer";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { EmbeddedFormProvider } from "../primitives/index.js";
import { PageSection } from "../primitives/layout.js";
import { formatMoney } from "../primitives/money-input.js";
import { Skeleton } from "../ui/skeleton.js";
import { initialWindowSelection, type StackedAreaRanges } from "../widgets/chart-window.js";
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
} from "../widgets/charts.js";
import { DashboardListTable } from "../widgets/dashboard-list.js";
import { FeedList, type FeedRow } from "../widgets/feed-list.js";
import { ModeSwitch } from "../widgets/mode-switch.js";
import { ProgressList, type ProgressListRow } from "../widgets/progress-list.js";
import { SectionCard } from "../widgets/section-card.js";
import { StatCard, type StatDelta, StatStripCell, type StatTone } from "../widgets/stat.js";
import { EmptyState, LoadingState } from "../widgets/states.js";
import { StatusBadge } from "../widgets/status-badge.js";

const STAT_TONES: ReadonlySet<string> = new Set(["default", "positive", "warn", "negative"]);
const SKELETON_SEGMENT_WIDTHS = ["100%", "72%", "48%"] as const;
const WIDE_PANEL = "sm:col-span-2 lg:col-span-4";
const HALF_PANEL = "sm:col-span-2 lg:col-span-2";
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const SKELETON_BAR_HEIGHTS = ["40%", "65%", "50%", "85%", "60%", "75%", "45%", "70%"];

type ScreenParams = {
  readonly filterParams: Readonly<Record<string, unknown>>;
  readonly rangeParams: Readonly<Record<string, unknown>>;
};

function panelPayload(
  panel: DashboardPanelQueryOptions,
  screenParams: ScreenParams,
): Readonly<Record<string, unknown>> {
  return {
    ...(panel.ignoreScreenFilter === true ? {} : screenParams.filterParams),
    ...screenParams.rangeParams,
    ...panel.params,
  };
}

type DashboardFormats = {
  readonly formatNumber: (value: number) => string;
  readonly formatPercent: (fraction: number) => string;
  readonly formatDay: (atMs: number) => string;
  readonly formatHour: (atMs: number) => string;
  readonly formatDateTime: (atMs: number) => string;
  readonly formatMedium: (atMs: number) => string;
  readonly formatMinor: (amountMinor: number, currency: string, fractionDigits?: number) => string;
  /** Number formatter for a panel; currency when `valueFormat` is set. */
  readonly formatPanelValue: (
    valueFormat: DashboardValueFormat | undefined,
  ) => (value: number) => string;
};

function useDashboardFormats(): DashboardFormats {
  const resolver = useLocale();
  const locale = resolver.locale();
  const timeZone = resolver.timeZone();
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  const percent = new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 0 });
  const day = new Intl.DateTimeFormat(locale, { day: "2-digit", month: "2-digit", timeZone });
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
    formatMedium: (atMs) => medium.format(atMs),
    formatMinor,
    formatPanelValue: (valueFormat) =>
      valueFormat === undefined
        ? (value) => number.format(value)
        : (value) => formatMinor(value, valueFormat.currency, valueFormat.fractionDigits),
    formatNumber: (value) => number.format(value),
    formatPercent: (fraction) => percent.format(fraction),
    formatDay: (atMs) => day.format(atMs),
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

function isTextParam(value: unknown): value is DashboardTextParam {
  return (
    typeof value === "string" ||
    typeof value === "number" ||
    isDashboardI18nText(value) ||
    isMoneyParam(value) ||
    isDateParam(value)
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
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border-row px-4">
        <h2 className="truncate text-sm font-semibold">{title}</h2>
        {subtitle !== undefined && (
          <span className="truncate text-xs text-muted-foreground">{subtitle}</span>
        )}
        {action !== undefined && <div className="ml-auto shrink-0">{action}</div>}
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
  readonly children: (data: TData) => ReactNode;
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
  const { data, error, loading, refetch } = useQuery<TData>(
    panel.query,
    panelPayload(panel, screenParams),
    { live: true },
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
    body = children(data);
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
  return typeof raw === "string" && STAT_TONES.has(raw) ? (raw as StatTone) : undefined;
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

  const { data, error, loading, refetch } = useQuery<Readonly<Record<string, unknown>>>(
    panel.query,
    panelPayload(panel, screenParams),
    { live: true },
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
  const value =
    typeof rawValue === "number"
      ? formats.formatPanelValue(panel.valueFormat)(rawValue)
      : (resolveDashboardText(rawValue, translate, formats) ?? fallbackText(rawValue, "—"));
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

function labeledGroupColumns(valueCount: number): string {
  if (valueCount <= 1) return "";
  return valueCount === 2 ? "sm:grid-cols-2" : "sm:grid-cols-3";
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
      <section className={`grid grid-cols-1 gap-3 ${labeledGroupColumns(panel.stats.length)}`}>
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
    return {
      atMs: marker.atMs,
      label: resolveDashboardText(marker.label, translate, formats) ?? "",
      ...(color !== undefined && { color }),
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
  const formats = useDashboardFormats();
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
  const [windowSelection, setWindowSelection] = useState(() => initialWindowSelection(ranges));
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
      {(data) => {
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
              formatBucketLabel={formats.formatDay}
              formatValue={formatValue}
              formatMarkerTime={formats.formatDay}
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
            {...(panel.valueFormat !== undefined && {
              yAxis: { ticks: 3, format: formatValue },
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
  const formats = useDashboardFormats();
  return (
    <QueryPanel<FeedEnvelope>
      panel={panel}
      label={label}
      screenParams={screenParams}
      translate={translate}
      skeleton="rows"
      isEmpty={(data) => (data.rows ?? []).length === 0}
    >
      {(data) => {
        const rows: readonly FeedRow[] = (data.rows ?? []).map((row, i) => {
          const trailing = resolveDashboardText(row.trailing, translate, formats);
          return {
            id: String(i),
            primary: resolveDashboardText(row.primary, translate, formats) ?? "—",
            ...(trailing !== undefined && { trailing }),
          };
        });
        return <FeedList rows={rows} />;
      }}
    </QueryPanel>
  );
}

type ProgressListEnvelope = {
  readonly rows?: readonly {
    readonly label: unknown;
    readonly value: unknown;
    readonly fraction: number;
    readonly sub?: unknown;
  }[];
};

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
  const formats = useDashboardFormats();
  return (
    <QueryPanel<ProgressListEnvelope>
      panel={panel}
      label={label}
      screenParams={screenParams}
      translate={translate}
      skeleton="rows"
      isEmpty={(data) => (data.rows ?? []).length === 0}
    >
      {(data) => {
        const rows: readonly ProgressListRow[] = (data.rows ?? []).map((row, i) => {
          const sub = resolveDashboardText(row.sub, translate, formats);
          return {
            id: String(i),
            label: resolveDashboardText(row.label, translate, formats) ?? "—",
            value: resolveDashboardText(row.value, translate, formats) ?? "—",
            fraction: row.fraction,
            ...(sub !== undefined && { sub }),
          };
        });
        return <ProgressList rows={rows} />;
      }}
    </QueryPanel>
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
function useFilterParams(screen: DashboardScreenDefinition): {
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
  }>(filter?.optionsQuery ?? "", {}, { enabled: filter?.optionsQuery !== undefined });

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
        filterParams={{ ...screenParams.filterParams, ...screenParams.rangeParams }}
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
  return (
    <ProgressListPanelBody
      panel={panel}
      label={text}
      screenParams={screenParams}
      translate={translate}
    />
  );
}

type VisibilityQueryResults = ReadonlyMap<
  string,
  UseQueryResult<Readonly<Record<string, unknown>>>
>;

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
  const dropsFilter = panel.kind !== "stat-group" && panel.ignoreScreenFilter === true;
  return visibilityGate(panel.visibleWhen.query, {
    ...(dropsFilter ? {} : screenParams.filterParams),
    ...screenParams.rangeParams,
  });
}

// One live query per distinct gate (query + payload), shared by every panel
// that gates on it — N panels on the same status query would otherwise each
// open their own request, SSE subscription and refetch per event.
function VisibilityQueryScope({
  gate,
  children,
}: {
  readonly gate: VisibilityGate;
  readonly children: ReactNode;
}): ReactNode {
  const parent = useContext(VisibilityQueryContext);
  const result = useQuery<Readonly<Record<string, unknown>>>(gate.query, gate.payload, {
    live: true,
  });
  const value = useMemo(() => new Map(parent).set(gate.key, result), [parent, gate.key, result]);
  return (
    <VisibilityQueryContext.Provider value={value}>{children}</VisibilityQueryContext.Provider>
  );
}

function VisibilityQueryScopes({
  gates,
  children,
}: {
  readonly gates: readonly VisibilityGate[];
  readonly children: ReactNode;
}): ReactNode {
  const [first, ...rest] = gates;
  if (first === undefined) return children;
  return (
    <VisibilityQueryScope gate={first}>
      <VisibilityQueryScopes gates={rest}>{children}</VisibilityQueryScopes>
    </VisibilityQueryScope>
  );
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
        <div className={className} data-testid={`dashboard-panel-${panel.id}`}>
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
  return <div className={className}>{children}</div>;
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
  if (target === undefined) return null;
  if (visibleWhen !== undefined) {
    const verdict = evalVisibleWhen(visibleWhen, visibility);
    // A failed gate query must not silently drop the panel: on the
    // account-security page that would hide every MFA enable/disable path.
    if (verdict === "error" && visibility?.error) {
      return (
        <div className={WIDE_PANEL} data-testid={`dashboard-panel-${panel.id}`}>
          <PanelError
            label={panel.label !== undefined ? translate(panel.label) : panel.id}
            error={visibility.error}
            onRetry={() => void visibility.refetch()}
          />
        </div>
      );
    }
    if (verdict !== "visible") return null;
  }
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
    <div className={WIDE_PANEL} data-testid={`dashboard-panel-${panel.id}`}>
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

// Starts at render time and restarts whenever the merged query params change;
// panels additionally report each successful (re)load, so live refetches and
// retries keep the stamp current.
function useLoadedAt(screenParams: ScreenParams): {
  readonly loadedAtMs: number;
  readonly reportLoaded: (atMs: number) => void;
} {
  const paramsKey = JSON.stringify([screenParams.filterParams, screenParams.rangeParams]);
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

export function WebDashboardBody({
  featureName,
  screen,
  translate,
}: DashboardBodyProps): ReactNode {
  const t = useTranslation();
  const effectiveTranslate = translate ?? t;
  const { Text, Banner, PageHeader } = usePrimitives();
  const headerSlotAvailable = usePageHeaderSlotAvailable();
  const { formatDateTime } = useDashboardFormats();
  const { params: filterParams, picker } = useFilterParams(screen);
  const { params: rangeParams, control: rangeControl } = useTimeRange(screen, effectiveTranslate);
  const screenParams: ScreenParams = { filterParams, rangeParams };
  const { loadedAtMs, reportLoaded } = useLoadedAt(screenParams);
  const visibilityGates = distinctVisibilityGates(screen.panels, screenParams);
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
  // The shell header owns the title; the badge sits right after it there.
  const badgeInHeader = scopeBadge !== null && headerSlotAvailable && PageHeader !== undefined;
  return (
    <PanelLoadedContext.Provider value={reportLoaded}>
      <PageSection className="flex flex-col gap-4" testId={`dashboard-${screen.id}`}>
        {badgeInHeader && <PageHeader status={scopeBadge} />}
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex items-center gap-2">
            {!badgeInHeader && scopeBadge}
            {picker}
          </div>
          <div className="flex flex-wrap items-center gap-3">
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
        <VisibilityQueryScopes gates={visibilityGates}>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
        </VisibilityQueryScopes>
      </PageSection>
    </PanelLoadedContext.Provider>
  );
}
