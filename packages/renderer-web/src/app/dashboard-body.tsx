// Web implementation of the dashboard screen type: renders the declared
// panels via the widget kit (StatCard, charts, FeedList, ProgressList,
// DashboardListTable) in a responsive grid. Registered via
// DashboardBodyProvider in createKumikoApp so the KumikoScreen switch stays
// platform-agnostic.
//
// Panel data contracts (see DashboardPanelDefinition in kumiko-framework):
//   stat          → flat record; valueField/subField/toneField point at
//                   values (strings are display-ready, the renderer formats
//                   numbers with the user locale). sparklineField → { atMs, value }[].
//                   deltaField/deltaDirectionField(+deltaToneField) are
//                   optional: the tile shows a delta chip ("↓23 %") only when
//                   BOTH fields are configured AND returned.
//                   icon/accentColor are static on the panel (not query
//                   fields): icon goes through extensionSectionComponents like
//                   custom panels, accentColor is a raw CSS color value.
//   stat-group    → several stat panels, each child stays an independent
//                   query; with a label it sits under a section title,
//                   without one it renders as a flat KPI strip.
//   chart         → depends on `chart`: timeseries { points, windowStartMs,
//                   windowEndMs, markers? }, stacked-bars / stacked-area
//                   { series, windowStartMs, windowEndMs, todayMs?, markers? },
//                   segment-bars { rows: { key, label, value, segments }[] }
//   list          → paged envelope { rows, nextCursor, total? } like
//                   projectionList.
//   feed          → { rows: { id, primary, trailing? }[] }
//   progress-list → { rows: { id, label, value, fraction }[] }
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
  DashboardChartPanel,
  DashboardCustomPanel,
  DashboardFeedPanel,
  DashboardListPanel,
  DashboardPanelDefinition,
  DashboardPanelEmptyState,
  DashboardPanelQueryOptions,
  DashboardProgressListPanel,
  DashboardScreenDefinition,
  DashboardScreenPanel,
  DashboardStatGroupPanel,
  DashboardStatPanel,
} from "@cosmicdrift/kumiko-framework/ui-types";
import { normalizeListColumn } from "@cosmicdrift/kumiko-framework/ui-types";
import type { Translate } from "@cosmicdrift/kumiko-headless";
import {
  type DashboardBodyProps,
  dispatcherErrorText,
  EmbeddedScreenProvider,
  extensionSectionName,
  KumikoScreen,
  useEmbeddedScreen,
  useExtensionSectionComponent,
  useLocale,
  useNav,
  usePageHeaderSlotAvailable,
  usePrimitives,
  useQuery,
  useTranslation,
} from "@cosmicdrift/kumiko-renderer";
import { type ReactNode, useEffect, useState } from "react";
import { EmbeddedFormProvider } from "../primitives/index.js";
import { PageSection } from "../primitives/layout.js";
import { Skeleton } from "../ui/skeleton.js";
import {
  type ChartMarker,
  type ChartSeries,
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
  return {
    formatNumber: (value) => number.format(value),
    formatPercent: (fraction) => percent.format(fraction),
    formatDay: (atMs) => day.format(atMs),
    formatHour: (atMs) => hour.format(atMs),
    formatDateTime: (atMs) => dateTime.format(atMs),
  };
}

function PanelShell({
  testId,
  title,
  subtitle,
  children,
}: {
  readonly testId: string;
  readonly title: string;
  readonly subtitle?: string;
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
    <PanelShell testId={`dashboard-panel-${panel.id}`} title={label} subtitle={subtitle}>
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

function StatPanelBody({
  panel,
  label,
  screenId,
  screenParams,
  variant,
}: {
  readonly panel: DashboardStatPanel;
  readonly label: string;
  readonly screenId: string;
  readonly screenParams: ScreenParams;
  readonly variant: "card" | "strip";
}): ReactNode {
  const { formatNumber } = useDashboardFormats();
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
  const value = typeof rawValue === "number" ? formatNumber(rawValue) : String(rawValue ?? "—");
  const spark = readSparkline(panel, record);
  const testId = `dashboard-panel-${panel.id}`;
  const subText = sub !== undefined && sub !== null ? String(sub) : undefined;

  if (variant === "strip") {
    return (
      <StatStripCell
        label={label}
        value={value}
        tone={tone ?? "default"}
        {...(subText !== undefined && { sub: subText })}
        {...(delta !== undefined && { delta })}
        {...(spark !== undefined && { spark })}
        testId={testId}
      />
    );
  }
  return (
    <StatCard
      icon={
        Icon !== undefined ? (
          <Icon
            entityName={screenId}
            entityId={null}
            screenId={screenId}
            filterParams={screenParams.filterParams}
          />
        ) : undefined
      }
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
            variant="strip"
          />
        ))}
      </div>
    );
  }
  return (
    <SectionCard title={label} testId={testId}>
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {panel.stats.map((stat) => (
          <StatPanelBody
            key={stat.id}
            panel={stat}
            label={translate(stat.label)}
            screenId={screenId}
            screenParams={screenParams}
            variant="card"
          />
        ))}
      </section>
    </SectionCard>
  );
}

type SeriesEnvelope = {
  readonly key: string;
  readonly label: string;
  readonly points: readonly TimeseriesPoint[];
};

type ChartEnvelope = {
  readonly points?: readonly TimeseriesPoint[];
  readonly series?: readonly SeriesEnvelope[];
  readonly rows?: readonly SegmentBarRow[];
  readonly windowStartMs?: number | null;
  readonly windowEndMs?: number | null;
  readonly todayMs?: number | null;
  readonly markers?: readonly ChartMarker[];
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
  const testId = `dashboard-chart-${panel.id}`;
  return (
    <QueryPanel<ChartEnvelope>
      panel={panel}
      label={label}
      subtitle={panel.subtitle !== undefined ? translate(panel.subtitle) : undefined}
      screenParams={screenParams}
      translate={translate}
      skeleton={panel.chart === "segment-bars" ? "segments" : "bars"}
      isEmpty={(data) => isChartEmpty(panel.chart, data, chartSeries(data, label, translate))}
    >
      {(data) => {
        const series = chartSeries(data, label, translate);
        const { startMs, endMs } = windowOf(data, series);
        if (panel.chart === "segment-bars") {
          return (
            <SegmentBarChart
              rows={(data.rows ?? []).map((row) => ({
                ...row,
                label: translate(row.label),
                segments: row.segments.map((seg) => ({ ...seg, label: translate(seg.label) })),
              }))}
              tones={tones}
              ariaLabel={label}
              formatValue={formats.formatNumber}
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
              ariaLabel={label}
              todayLabel={todayLabel}
              formatBucketLabel={
                spacing < DAY_MS - HOUR_MS ? formats.formatHour : formats.formatDay
              }
              formatValue={formats.formatNumber}
              testId={testId}
            />
          );
        }
        if (panel.chart === "stacked-area") {
          return (
            <StackedAreaChart
              series={series}
              windowStartMs={startMs}
              windowEndMs={endMs}
              {...(data.todayMs !== undefined &&
                data.todayMs !== null && { todayMs: data.todayMs })}
              tones={tones}
              markers={data.markers}
              ariaLabel={label}
              todayLabel={todayLabel}
              formatBucketLabel={formats.formatDay}
              formatValue={formats.formatNumber}
              formatMarkerTime={formats.formatDay}
              testId={testId}
            />
          );
        }
        return (
          <TimeseriesChart
            points={data.points ?? []}
            windowStartMs={startMs}
            windowEndMs={endMs}
            markers={data.markers}
            formatMarkerTime={formats.formatDay}
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
  readonly rows?: readonly { readonly primary: string; readonly trailing?: string }[];
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
      {(data) => {
        const rows: readonly FeedRow[] = (data.rows ?? []).map((row, i) => ({
          id: String(i),
          ...row,
        }));
        return <FeedList rows={rows} />;
      }}
    </QueryPanel>
  );
}

type ProgressListEnvelope = {
  readonly rows?: readonly {
    readonly label: string;
    readonly value: string;
    readonly fraction: number;
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
        const rows: readonly ProgressListRow[] = (data.rows ?? []).map((row, i) => ({
          id: String(i),
          ...row,
        }));
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
  const value = timeRange.options.some((o) => o.value === fromUrl)
    ? (fromUrl as string)
    : timeRange.default;
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
  const visibility = useQuery<Readonly<Record<string, unknown>>>(
    visibleWhen?.query ?? "",
    {},
    { enabled: visibleWhen !== undefined, live: true },
  );
  const target = useEmbeddedScreen(featureName, panel.screen);
  if (target === undefined) return null;
  if (visibleWhen !== undefined && visibility.data?.[visibleWhen.field] !== visibleWhen.eq) {
    return null;
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

// Render time of the screen, refreshed whenever the merged query params
// change — the closest cheap proxy for "last loaded".
function useLoadedAt(screenParams: ScreenParams): number {
  const paramsKey = JSON.stringify([screenParams.filterParams, screenParams.rangeParams]);
  const [loaded, setLoaded] = useState(() => ({ paramsKey, atMs: Date.now() }));
  if (loaded.paramsKey !== paramsKey) setLoaded({ paramsKey, atMs: Date.now() });
  return loaded.atMs;
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
  const loadedAtMs = useLoadedAt(screenParams);
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
            <div key={panel.id} className={panelSpanClassName(panel)}>
              <PanelBody
                panel={panel}
                label={label}
                screenId={screen.id}
                screenParams={screenParams}
                translate={effectiveTranslate}
              />
            </div>
          );
        })}
      </div>
    </PageSection>
  );
}
