// Web-Implementierung des dashboard-Screen-Typs: rendert die deklarierten
// Panels über das Widget-Kit (StatCard, TimeseriesChart, QueryTable, FeedList,
// ProgressList) in einem responsiven Grid. Registriert via
// DashboardBodyProvider in createKumikoApp — der KumikoScreen-Switch bleibt
// plattform-agnostisch.
//
// Panel-Daten-Contracts (siehe DashboardPanelDefinition in kumiko-framework):
//   stat          → flaches Record, valueField/subField/toneField zeigen auf
//                   anzeigefertige Werte (der Query-Handler formatiert).
//                   deltaField/deltaDirectionField(+deltaToneField) sind
//                   optional — nur wenn BEIDE Felder gesetzt sind UND geliefert
//                   werden, zeigt die Kachel einen Delta-Chip ("↓23 %").
//                   icon/accentColor sind statisch am Panel (keine Query-
//                   Felder) — icon über extensionSectionComponents wie bei
//                   custom-Panels, accentColor ein roher CSS-Farbwert.
//   stat-group    → mehrere stat-Panels unter einem Sektions-Titel, jedes
//                   Kind bleibt eine eigenständige Query.
//   chart         → { points: { atMs, value | null }[], windowStartMs,
//                   windowEndMs }
//   list          → paged envelope { rows, nextCursor, total? } wie
//                   projectionList.
//   feed          → { rows: { id, primary, trailing? }[] }
//   progress-list → { rows: { id, label, value, fraction }[] }
//   custom        → keine Query — eine über extensionSectionComponents
//                   registrierte App-Komponente holt sich ihre Daten selbst.
//
// Screen-Filter (DashboardFilterDefinition): der gewählte Wert wird unter
// `filter.id` in JEDE Panel-Query gemerged. useQuery refetcht automatisch
// über seinen bestehenden payloadKey-Mechanismus — kein Sonderfall nötig.

import type {
  DashboardChartPanel,
  DashboardCustomPanel,
  DashboardFeedPanel,
  DashboardListPanel,
  DashboardPanelDefinition,
  DashboardProgressListPanel,
  DashboardScreenDefinition,
  DashboardStatGroupPanel,
  DashboardStatPanel,
} from "@cosmicdrift/kumiko-framework/ui-types";
import { normalizeListColumn } from "@cosmicdrift/kumiko-framework/ui-types";
import {
  type DashboardBodyProps,
  extensionSectionName,
  useExtensionSectionComponent,
  usePrimitives,
  useQuery,
  useTranslation,
} from "@cosmicdrift/kumiko-renderer";
import { type ReactNode, useEffect, useState } from "react";
import { TimeseriesChart, type TimeseriesPoint } from "../widgets/charts";
import { FeedList, type FeedRow } from "../widgets/feed-list";
import { ProgressList, type ProgressListRow } from "../widgets/progress-list";
import { QueryTable } from "../widgets/query-table";
import { SectionCard } from "../widgets/section-card";
import { StatCard, type StatDelta, type StatTone } from "../widgets/stat";
import { ErrorState, LoadingState } from "../widgets/states";

const STAT_TONES: ReadonlySet<string> = new Set(["default", "positive", "warn"]);
const WIDE_PANEL = "sm:col-span-2 lg:col-span-4";
const HALF_PANEL = "sm:col-span-2 lg:col-span-2";

function StatPanelBody({
  panel,
  label,
  screenId,
  filterParams,
}: {
  readonly panel: DashboardStatPanel;
  readonly label: string;
  readonly screenId: string;
  readonly filterParams: Readonly<Record<string, unknown>>;
}): ReactNode {
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
    filterParams,
    { live: true },
  );
  if (loading && data === null) return <LoadingState rows={2} />;
  if (error !== null) return <ErrorState error={error} onRetry={() => void refetch()} />;
  const record = data ?? {};
  const rawTone = panel.toneField !== undefined ? record[panel.toneField] : undefined;
  const tone =
    typeof rawTone === "string" && STAT_TONES.has(rawTone) ? (rawTone as StatTone) : "default";
  const sub = panel.subField !== undefined ? record[panel.subField] : undefined;
  const delta = readDelta(panel, record);
  return (
    <StatCard
      icon={
        Icon !== undefined ? (
          <Icon
            entityName={screenId}
            entityId={null}
            screenId={screenId}
            filterParams={filterParams}
          />
        ) : undefined
      }
      label={label}
      value={String(record[panel.valueField] ?? "—")}
      tone={tone}
      {...(Icon !== undefined && { accentColor: panel.accentColor })}
      {...(sub !== undefined && sub !== null && { sub: String(sub) })}
      {...(delta !== undefined && { delta })}
      testId={`dashboard-panel-${panel.id}`}
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
  const rawTone = panel.deltaToneField !== undefined ? record[panel.deltaToneField] : undefined;
  const tone =
    typeof rawTone === "string" && STAT_TONES.has(rawTone) ? (rawTone as StatTone) : undefined;
  return { value: String(value), direction, ...(tone !== undefined && { tone }) };
}

function StatGroupPanelBody({
  panel,
  label,
  screenId,
  filterParams,
}: {
  readonly panel: DashboardStatGroupPanel;
  readonly label: string;
  readonly screenId: string;
  readonly filterParams: Readonly<Record<string, unknown>>;
}): ReactNode {
  const t = useTranslation();
  return (
    <SectionCard title={label} testId={`dashboard-panel-${panel.id}`}>
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {panel.stats.map((stat) => (
          <StatPanelBody
            key={stat.id}
            panel={stat}
            label={t(stat.label)}
            screenId={screenId}
            filterParams={filterParams}
          />
        ))}
      </section>
    </SectionCard>
  );
}

type TimeseriesEnvelope = {
  readonly points: readonly TimeseriesPoint[];
  readonly windowStartMs: number;
  readonly windowEndMs: number;
};

function ChartPanelBody({
  panel,
  label,
  filterParams,
}: {
  readonly panel: DashboardChartPanel;
  readonly label: string;
  readonly filterParams: Readonly<Record<string, unknown>>;
}): ReactNode {
  const t = useTranslation();
  const { data, error, loading, refetch } = useQuery<TimeseriesEnvelope>(
    panel.query,
    filterParams,
    { live: true },
  );
  if (loading && data === null) return <LoadingState rows={3} />;
  if (error !== null) return <ErrorState error={error} onRetry={() => void refetch()} />;
  return (
    <SectionCard title={label} testId={`dashboard-panel-${panel.id}`}>
      <TimeseriesChart
        points={data?.points ?? []}
        windowStartMs={data?.windowStartMs ?? 0}
        windowEndMs={data?.windowEndMs ?? 1}
        ariaLabel={label}
        emptyContent={t("kumiko.list.no-entries")}
      />
    </SectionCard>
  );
}

function ListPanelBody({
  panel,
  label,
  filterParams,
}: {
  readonly panel: DashboardListPanel;
  readonly label: string;
  readonly filterParams: Readonly<Record<string, unknown>>;
}): ReactNode {
  const t = useTranslation();
  return (
    <SectionCard title={label} testId={`dashboard-panel-${panel.id}`}>
      <QueryTable<{ readonly rows: readonly Readonly<Record<string, unknown>>[] }>
        query={panel.query}
        payload={filterParams}
        live
        columns={panel.columns.map((c) => {
          const normalized = normalizeListColumn(c);
          return {
            field: normalized.field,
            label: t(normalized.label ?? normalized.field),
          };
        })}
        rows={(data) => data.rows}
      />
    </SectionCard>
  );
}

type FeedEnvelope = {
  readonly rows: readonly { readonly primary: string; readonly trailing?: string }[];
};

function FeedPanelBody({
  panel,
  label,
  filterParams,
}: {
  readonly panel: DashboardFeedPanel;
  readonly label: string;
  readonly filterParams: Readonly<Record<string, unknown>>;
}): ReactNode {
  const t = useTranslation();
  const { data, error, loading, refetch } = useQuery<FeedEnvelope>(panel.query, filterParams, {
    live: true,
  });
  if (loading && data === null) return <LoadingState rows={3} />;
  if (error !== null) return <ErrorState error={error} onRetry={() => void refetch()} />;
  const rows: readonly FeedRow[] = (data?.rows ?? []).map((row, i) => ({ id: String(i), ...row }));
  return (
    <SectionCard title={label} testId={`dashboard-panel-${panel.id}`}>
      <FeedList rows={rows} emptyContent={t(panel.emptyLabel ?? "kumiko.list.no-entries")} />
    </SectionCard>
  );
}

type ProgressListEnvelope = {
  readonly rows: readonly {
    readonly label: string;
    readonly value: string;
    readonly fraction: number;
  }[];
};

function ProgressListPanelBody({
  panel,
  label,
  filterParams,
}: {
  readonly panel: DashboardProgressListPanel;
  readonly label: string;
  readonly filterParams: Readonly<Record<string, unknown>>;
}): ReactNode {
  const t = useTranslation();
  const { data, error, loading, refetch } = useQuery<ProgressListEnvelope>(
    panel.query,
    filterParams,
    { live: true },
  );
  if (loading && data === null) return <LoadingState rows={3} />;
  if (error !== null) return <ErrorState error={error} onRetry={() => void refetch()} />;
  const rows: readonly ProgressListRow[] = (data?.rows ?? []).map((row, i) => ({
    id: String(i),
    ...row,
  }));
  return (
    <SectionCard title={label} testId={`dashboard-panel-${panel.id}`}>
      <ProgressList rows={rows} emptyContent={t("kumiko.list.no-entries")} />
    </SectionCard>
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

// Screen-Filter: hält den gewählten Wert, rendert die Combobox, und liefert
// den Payload-Merge für jede Panel-Query. Statische `options` werden als
// i18n-Keys übersetzt; `optionsQuery`-Ergebnisse sind Server-Daten und werden
// unverändert übernommen.
function useFilterParams(screen: DashboardScreenDefinition): {
  readonly params: Readonly<Record<string, unknown>>;
  readonly picker: ReactNode;
} {
  const { Field, Input } = usePrimitives();
  const t = useTranslation();
  const filter = screen.filter;
  const [value, setValue] = useState("");
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
          onChange={setValue}
          placeholder={filter.placeholder !== undefined ? t(filter.placeholder) : allLabel}
        />
      </Field>
    </div>
  );
  const params = value === "" ? {} : { [filter.id]: value };
  return { params, picker };
}

function panelSpanClassName(panel: DashboardPanelDefinition): string | undefined {
  if (panel.kind === "stat") return undefined;
  if (panel.kind === "feed" || panel.kind === "progress-list") return HALF_PANEL;
  return WIDE_PANEL;
}

function PanelBody({
  panel,
  label,
  screenId,
  filterParams,
}: {
  readonly panel: DashboardPanelDefinition;
  readonly label: string;
  readonly screenId: string;
  readonly filterParams: Readonly<Record<string, unknown>>;
}): ReactNode {
  if (panel.kind === "stat")
    return (
      <StatPanelBody panel={panel} label={label} screenId={screenId} filterParams={filterParams} />
    );
  if (panel.kind === "stat-group") {
    return (
      <StatGroupPanelBody
        panel={panel}
        label={label}
        screenId={screenId}
        filterParams={filterParams}
      />
    );
  }
  if (panel.kind === "chart")
    return <ChartPanelBody panel={panel} label={label} filterParams={filterParams} />;
  if (panel.kind === "list")
    return <ListPanelBody panel={panel} label={label} filterParams={filterParams} />;
  if (panel.kind === "feed")
    return <FeedPanelBody panel={panel} label={label} filterParams={filterParams} />;
  if (panel.kind === "progress-list") {
    return <ProgressListPanelBody panel={panel} label={label} filterParams={filterParams} />;
  }
  return <CustomPanelBody panel={panel} screenId={screenId} filterParams={filterParams} />;
}

export function WebDashboardBody({ screen, translate }: DashboardBodyProps): ReactNode {
  const t = useTranslation();
  const effectiveTranslate = translate ?? t;
  const { params: filterParams, picker } = useFilterParams(screen);
  return (
    <div className="flex flex-col gap-4 p-6" data-testid={`dashboard-${screen.id}`}>
      {picker}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {screen.panels.map((panel) => {
          const label = panel.kind === "custom" ? "" : effectiveTranslate(panel.label);
          const span = panelSpanClassName(panel);
          return (
            <div key={panel.id} className={span}>
              <PanelBody
                panel={panel}
                label={label}
                screenId={screen.id}
                filterParams={filterParams}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
