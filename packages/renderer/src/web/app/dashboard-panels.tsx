import type {
  DashboardChartMarkerKind,
  DashboardChartPanel,
  DashboardCustomPanel,
  DashboardFeedPanel,
  DashboardListPanel,
  DashboardProgressListPanel,
  DashboardProgressTone,
  DashboardStatGroupPanel,
  DashboardStatPanel,
  DashboardTextBlock,
  DashboardTextPanel,
} from "@cosmicdrift/kumiko-framework/ui-types";
import { normalizeListColumn } from "@cosmicdrift/kumiko-framework/ui-types";
import { DASHBOARD_STAT_TONES } from "@cosmicdrift/kumiko-types/screen";
import { isOneOf } from "@cosmicdrift/kumiko-types/type-guards";
import { type ReactNode, useEffect, useState } from "react";
import { EMPTY_VALUE_PLACEHOLDER, type Translate } from "../../headless/index.ts";
import {
  extensionSectionName,
  lastSegment,
  useExtensionSectionComponent,
  useNav,
  usePrimitives,
  useTranslation,
  useUserRoles,
} from "../../index.ts";
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
import {
  DAY_MS,
  type DashboardFormats,
  HOUR_MS,
  PanelError,
  PanelShell,
  panelPayload,
  QueryPanel,
  type ScreenParams,
  useDashboardFormats,
  useDashboardQuery,
  useReportPanelLoaded,
} from "./dashboard-shared.tsx";
import { isRecord, resolveDashboardText } from "./dashboard-text.ts";

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

export function StatPanelBody({
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
      // biome-ignore lint/suspicious/noConsole: dev warning for setup errors
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

export function StatGroupPanelBody({
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

export function ChartPanelBody({
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

export function ListPanelBody({
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

export function FeedPanelBody({
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

export function ProgressListPanelBody({
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
    case "link":
      return <TextBlockLink block={block} translate={translate} />;
  }
}

function TextBlockLink({
  block,
  translate,
}: {
  readonly block: Extract<DashboardTextBlock, { readonly kind: "link" }>;
  readonly translate: Translate;
}): ReactNode {
  const { Link } = usePrimitives();
  const nav = useNav();
  const userRoles = useUserRoles();
  if (block.roles !== undefined && !block.roles.some((role) => userRoles?.includes(role))) {
    return null;
  }
  const target = { screenId: lastSegment(block.screen) };
  return (
    <Link
      href={nav.hrefFor(target)}
      onPress={() => nav.navigate(target)}
      testId={`dashboard-text-link-${target.screenId}`}
    >
      {translate(block.text)}
    </Link>
  );
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

export function TextPanelBody({
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

// Resolves panel.component through the same extensionSectionComponents
// registry as entityEdit extension sections and list header slots; it
// stays at its array position instead of moving into a separate slot (see
// the file header comment on the registry). Renders nothing + a dev warning
// for an unregistered name, analogous to ListHeaderSlotMount in
// render-list.tsx.
export function CustomPanelBody({
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
      // biome-ignore lint/suspicious/noConsole: dev warning for setup errors
      console.warn(
        `[kumiko] Dashboard custom-panel "${panel.id}" on screen "${screenId}" references component ` +
          `"${name}", which is not registered in clientFeatures.extensionSectionComponents — the panel renders nothing.`,
      );
    }
  }, [name, Component, panel.id, screenId]);
  if (Component === undefined) return null;
  // Dashboard panels have no entity; entityName carries the screen.id so
  // ExtensionSectionProps need not be loosened for this one mount site (that
  // would break every existing registered section that expects entityName to
  // be a guaranteed string).
  return (
    <Component
      entityName={screenId}
      entityId={null}
      screenId={screenId}
      filterParams={filterParams}
    />
  );
}
