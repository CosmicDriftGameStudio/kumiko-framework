// Declarative panel sets of the two overview dashboards. Panels are derived from
// the metric list the app mounts, so a reduced list yields a reduced dashboard
// instead of panels pointing at queries that do not exist.

import type {
  DashboardChartPanel,
  DashboardFilterDefinition,
  DashboardListPanel,
  DashboardPanelDefinition,
  DashboardPanelSpan,
  DashboardStatPanel,
  DashboardTimeRangeDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import { CapOverviewQueries } from "../cap-overview/index.js";
import { JobQueries } from "../jobs/index.js";
import { type MetricDefinition, type MetricScope, metricQueryName } from "../metrics/index.js";

const I = "admin-shell:overview";

export const OVERVIEW_TIME_RANGE: DashboardTimeRangeDefinition = {
  id: "range",
  options: [
    { value: "24h", label: `${I}.range.24h` },
    { value: "7d", label: `${I}.range.7d` },
    { value: "30d", label: `${I}.range.30d` },
  ],
  default: "7d",
};

export const PLATFORM_TENANT_FILTER: DashboardFilterDefinition = {
  id: "tenantId",
  label: `${I}.filter.tenant`,
  kind: "select",
  allLabel: `${I}.filter.allTenants`,
  optionsQuery: CapOverviewQueries.tenantOptions,
};

export const PLATFORM_SCOPE = {
  badge: `${I}.scope.badge`,
  notice: `${I}.scope.notice`,
} as const;

type MetricPanelContext = {
  readonly scope: MetricScope;
  readonly has: (metricId: string) => boolean;
};

function contextFor(metrics: readonly MetricDefinition[], scope: MetricScope): MetricPanelContext {
  return {
    scope,
    has: (metricId) =>
      metrics.some((metric) => metric.id === metricId && metric.scopes.includes(scope)),
  };
}

function kpi(
  ctx: MetricPanelContext,
  metricId: string,
  label: string,
  options: { readonly trend?: boolean; readonly negative?: boolean } = {},
): readonly DashboardStatPanel[] {
  if (!ctx.has(metricId)) return [];
  return [
    {
      kind: "stat",
      id: `kpi-${metricId}`,
      label: `${I}.kpi.${label}`,
      query: metricQueryName(ctx.scope, metricId),
      valueField: "value",
      ...(options.trend === true && {
        deltaField: "delta",
        deltaDirectionField: "deltaDirection",
        sparklineField: "points",
      }),
      ...(options.negative === true && { tone: "negative" as const }),
    },
  ];
}

function kpiStrip(stats: readonly DashboardStatPanel[]): readonly DashboardPanelDefinition[] {
  return stats.length === 0 ? [] : [{ kind: "stat-group", id: "kpis", stats }];
}

function chart(
  ctx: MetricPanelContext,
  metricId: string,
  panel: Omit<DashboardChartPanel, "kind" | "query">,
): readonly DashboardPanelDefinition[] {
  if (!ctx.has(metricId)) return [];
  return [{ kind: "chart", query: metricQueryName(ctx.scope, metricId), ...panel }];
}

const DELIVERY_SEGMENT_TONES = {
  sent: "positive",
  failed: "negative",
  skipped: "neutral",
  queued: "neutral",
} as const;

const HALF = { span: "half" } as const;

function recentFailuresList(
  query: string,
  params: Readonly<Record<string, unknown>>,
  columns: DashboardListPanel["columns"],
  span: DashboardPanelSpan,
): DashboardPanelDefinition {
  return {
    kind: "list",
    id: "recent-failures",
    label: `${I}.list.recentFailures`,
    query,
    params,
    ignoreScreenFilter: true,
    columns,
    span,
    emptyLabel: `${I}.list.recentFailuresEmpty`,
  };
}

export function platformOverviewPanels(
  metrics: readonly MetricDefinition[],
): readonly DashboardPanelDefinition[] {
  const ctx = contextFor(metrics, "system");
  // Sources without a tenant column cannot be narrowed by the tenant picker.
  const tenantless = (panel: DashboardStatPanel): DashboardStatPanel => ({
    ...panel,
    ignoreScreenFilter: true,
  });
  return [
    ...kpiStrip([
      ...kpi(ctx, "active-tenants", "activeTenants").map(tenantless),
      ...kpi(ctx, "active-users", "activeUsers7d", { trend: true }),
      ...kpi(ctx, "failed-job-runs", "failedJobs24h", { trend: true, negative: true }).map(
        tenantless,
      ),
      ...kpi(ctx, "failed-deliveries", "failedDeliveries24h", { trend: true, negative: true }),
    ]),
    ...chart(ctx, "job-runs-by-status", {
      id: "job-runs-by-status",
      label: `${I}.chart.jobRunsByStatus`,
      chart: "stacked-bars",
      ...HALF,
      ignoreScreenFilter: true,
      seriesTones: {
        completed: "positive",
        failed: "negative",
        running: "active",
        queued: "neutral",
      },
    }),
    ...chart(ctx, "deliveries-by-channel", {
      id: "deliveries-by-channel",
      label: `${I}.chart.deliveriesByChannel`,
      chart: "segment-bars",
      ...HALF,
      seriesTones: DELIVERY_SEGMENT_TONES,
    }),
    recentFailuresList(
      JobQueries.list,
      { status: "failed", sort: "startedAt", sortDirection: "desc", limit: 5 },
      [
        { field: "jobName", label: `${I}.col.job` },
        { field: "startedAt", label: `${I}.col.startedAt`, display: "datetime" as const },
      ],
      "full",
    ),
  ];
}

export function tenantOverviewPanels(
  metrics: readonly MetricDefinition[],
  options: { readonly includeCapOverview: boolean },
): readonly DashboardPanelDefinition[] {
  const ctx = contextFor(metrics, "tenant");
  return [
    ...kpiStrip([
      ...kpi(ctx, "active-users", "activeMembers7d", { trend: true }),
      ...kpi(ctx, "tenant-job-failures", "failedJobs24h", { trend: true, negative: true }),
      ...kpi(ctx, "failed-deliveries", "failedDeliveries24h", { trend: true, negative: true }),
    ]),
    ...chart(ctx, "deliveries-by-channel", {
      id: "deliveries-by-channel",
      label: `${I}.chart.deliveriesByChannel`,
      chart: "segment-bars",
      ...HALF,
      seriesTones: DELIVERY_SEGMENT_TONES,
    }),
    ...(options.includeCapOverview
      ? [
          {
            kind: "list" as const,
            id: "quotas",
            label: `${I}.list.quotas`,
            query: CapOverviewQueries.capsUsage,
            columns: [
              { field: "label", label: `${I}.col.quota` },
              { field: "used", label: `${I}.col.used` },
              { field: "limit", label: `${I}.col.limit` },
              { field: "fraction", label: `${I}.col.usage`, display: "bar" as const },
            ],
            ...HALF,
            emptyLabel: `${I}.list.quotasEmpty`,
          },
        ]
      : []),
    ...chart(ctx, "audit-writes", {
      id: "audit-writes",
      label: `${I}.chart.auditWrites`,
      subtitle: `${I}.chart.auditWritesSubtitle`,
      chart: "stacked-bars",
      ...HALF,
    }),
    recentFailuresList(
      JobQueries.failures,
      { limit: 5 },
      [
        { field: "jobName", label: `${I}.col.job` },
        { field: "messageKey", label: `${I}.col.reason` },
        { field: "failedAt", label: `${I}.col.failedAt`, display: "datetime" as const },
      ],
      "half",
    ),
  ];
}
