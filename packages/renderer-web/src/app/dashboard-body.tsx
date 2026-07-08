// Web-Implementierung des dashboard-Screen-Typs: rendert die deklarierten
// Panels über das Widget-Kit (StatCard, TimeseriesChart, QueryTable) in
// einem responsiven Grid. Registriert via DashboardBodyProvider in
// createKumikoApp — der KumikoScreen-Switch bleibt plattform-agnostisch.
//
// Panel-Daten-Contracts (siehe DashboardPanelDefinition in kumiko-framework):
//   stat  → flaches Record, valueField/subField/toneField zeigen auf
//           anzeigefertige Werte (der Query-Handler formatiert).
//   chart → { points: { atMs, value | null }[], windowStartMs, windowEndMs }
//   list  → paged envelope { rows, nextCursor, total? } wie projectionList.

import type {
  DashboardChartPanel,
  DashboardListPanel,
  DashboardStatPanel,
} from "@cosmicdrift/kumiko-framework/ui-types";
import { normalizeListColumn } from "@cosmicdrift/kumiko-framework/ui-types";
import { type DashboardBodyProps, useQuery, useTranslation } from "@cosmicdrift/kumiko-renderer";
import type { ReactNode } from "react";
import { TimeseriesChart, type TimeseriesPoint } from "../widgets/charts";
import { QueryTable } from "../widgets/query-table";
import { SectionCard } from "../widgets/section-card";
import { StatCard, type StatTone } from "../widgets/stat";
import { ErrorState, LoadingState } from "../widgets/states";

const STAT_TONES: ReadonlySet<string> = new Set(["default", "positive", "warn"]);

function StatPanelBody({
  panel,
  label,
}: {
  readonly panel: DashboardStatPanel;
  readonly label: string;
}): ReactNode {
  const { data, error, loading, refetch } = useQuery<Readonly<Record<string, unknown>>>(
    panel.query,
    {},
    { live: true },
  );
  if (loading && data === null) return <LoadingState rows={2} />;
  if (error !== null) return <ErrorState error={error} onRetry={() => void refetch()} />;
  const record = data ?? {};
  const rawTone = panel.toneField !== undefined ? record[panel.toneField] : undefined;
  const tone =
    typeof rawTone === "string" && STAT_TONES.has(rawTone) ? (rawTone as StatTone) : "default";
  const sub = panel.subField !== undefined ? record[panel.subField] : undefined;
  return (
    <StatCard
      label={label}
      value={String(record[panel.valueField] ?? "—")}
      tone={tone}
      {...(sub !== undefined && sub !== null && { sub: String(sub) })}
      testId={`dashboard-panel-${panel.id}`}
    />
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
}: {
  readonly panel: DashboardChartPanel;
  readonly label: string;
}): ReactNode {
  const t = useTranslation();
  const { data, error, loading, refetch } = useQuery<TimeseriesEnvelope>(
    panel.query,
    {},
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
}: {
  readonly panel: DashboardListPanel;
  readonly label: string;
}): ReactNode {
  const t = useTranslation();
  return (
    <SectionCard title={label} testId={`dashboard-panel-${panel.id}`}>
      <QueryTable<{ readonly rows: readonly Readonly<Record<string, unknown>>[] }>
        query={panel.query}
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

export function WebDashboardBody({ screen, translate }: DashboardBodyProps): ReactNode {
  const t = useTranslation();
  const effectiveTranslate = translate ?? t;
  return (
    <div
      className="grid gap-4 p-6 sm:grid-cols-2 lg:grid-cols-4"
      data-testid={`dashboard-${screen.id}`}
    >
      {screen.panels.map((panel) => {
        const label = effectiveTranslate(panel.label);
        if (panel.kind === "stat") {
          return <StatPanelBody key={panel.id} panel={panel} label={label} />;
        }
        if (panel.kind === "chart") {
          return (
            <div key={panel.id} className="sm:col-span-2 lg:col-span-4">
              <ChartPanelBody panel={panel} label={label} />
            </div>
          );
        }
        return (
          <div key={panel.id} className="sm:col-span-2 lg:col-span-4">
            <ListPanelBody panel={panel} label={label} />
          </div>
        );
      })}
    </div>
  );
}
