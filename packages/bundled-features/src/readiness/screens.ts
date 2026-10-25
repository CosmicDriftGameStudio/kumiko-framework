import type {
  EditRelatedListSection,
  ListColumnSpec,
  ProjectionDetailScreenDefinition,
  RowAction,
} from "@cosmicdrift/kumiko-framework/ui-types";
import { ReadinessQueries, ReadinessWrites } from "./constants.ts";

export const SYSTEM_CHECK_SCREEN_ID = "system-check";
export const SYSTEM_CHECK_RUN_SCREEN_ID = "system-check-run";
export const SYSTEM_CHECK_SCREEN_QN = `readiness:screen:${SYSTEM_CHECK_SCREEN_ID}`;
export const SYSTEM_CHECK_NAV_LABEL = "readiness:nav.systemCheck";

export const ScreenTextKeys = {
  runAction: "readiness.screen.action.run",
  runPaidAction: "readiness.screen.action.run-paid",
  latestTitle: "readiness.screen.latest.title",
  latestDescription: "readiness.screen.latest.description",
  latestEmpty: "readiness.screen.latest.empty",
  historyTitle: "readiness.screen.history.title",
  historyDescription: "readiness.screen.history.description",
  historyEmpty: "readiness.screen.history.empty",
  runResultsTitle: "readiness.screen.run.results-title",
  metricOk: "readiness.screen.metric.ok",
  metricFailed: "readiness.screen.metric.failed",
  metricSkipped: "readiness.screen.metric.skipped",
  columnArea: "readiness.screen.column.area",
  columnCheck: "readiness.screen.column.check",
  columnStatus: "readiness.screen.column.status",
  columnDuration: "readiness.screen.column.duration",
  columnResult: "readiness.screen.column.result",
  columnStarted: "readiness.screen.column.started",
  columnStartedBy: "readiness.screen.column.started-by",
  columnOutcome: "readiness.screen.column.outcome",
} as const;

export const RESULT_STATUS_KEY_PREFIX = "readiness.result-status.";
export const RUN_OUTCOME_KEY_PREFIX = "readiness.outcome.";

const ACCESS = { roles: ["TenantAdmin", "SystemAdmin"] } as const;

const RESULT_COLUMNS: readonly ListColumnSpec[] = [
  { field: "area", label: ScreenTextKeys.columnArea, renderer: { format: "i18nText" } },
  { field: "label", label: ScreenTextKeys.columnCheck, renderer: { format: "i18nText" } },
  {
    field: "status",
    label: ScreenTextKeys.columnStatus,
    renderer: {
      format: "enumOption",
      keyPrefix: RESULT_STATUS_KEY_PREFIX,
      tones: { ok: "ok", failed: "bad", skipped: "neutral" },
    },
  },
  {
    field: "durationMs",
    label: ScreenTextKeys.columnDuration,
    valueType: "number",
    renderer: { format: "number" },
    hideOnNarrow: true,
  },
  {
    field: "message",
    label: ScreenTextKeys.columnResult,
    renderer: { format: "i18nText" },
    linkScreenField: "fixScreen",
  },
];

function resultsSection(
  query: string,
  title: string,
  extra: Partial<EditRelatedListSection>,
): EditRelatedListSection {
  return {
    kind: "relatedList",
    title,
    query,
    columns: RESULT_COLUMNS,
    emptyState: { title: ScreenTextKeys.latestEmpty },
    ...extra,
  };
}

const RESULT_METRICS = [
  { field: "okCount", label: ScreenTextKeys.metricOk, tone: "ok", icon: "check-circle" },
  { field: "failedCount", label: ScreenTextKeys.metricFailed, tone: "negative", icon: "x-circle" },
  { field: "skippedCount", label: ScreenTextKeys.metricSkipped, icon: "circle-stop" },
] as const;

// The paid button sends hasPaidProbes as includePaid: it is only visible while that field is true.
const RUN_ACTIONS: readonly RowAction[] = [
  {
    kind: "writeHandler",
    id: "run-check",
    label: ScreenTextKeys.runAction,
    handler: ReadinessWrites.runProbes,
    payload: { pick: [] },
    style: "primary",
    icon: "shield-check",
  },
  {
    kind: "writeHandler",
    id: "run-paid-check",
    label: ScreenTextKeys.runPaidAction,
    handler: ReadinessWrites.runProbes,
    payload: { map: { includePaid: "hasPaidProbes" } },
    visible: { field: "hasPaidProbes", eq: true },
    style: "secondary",
    icon: "sparkles",
  },
];

export function systemCheckScreen(dormant: boolean): ProjectionDetailScreenDefinition {
  return {
    id: SYSTEM_CHECK_SCREEN_ID,
    type: "projectionDetail",
    query: ReadinessQueries.latestSummary,
    singleton: true,
    live: true,
    dormant,
    access: ACCESS,
    actions: RUN_ACTIONS,
    primaryAction: "run-check",
    metrics: RESULT_METRICS,
    metricsStyle: "tiles",
    layout: {
      width: "full",
      sections: [
        resultsSection(ReadinessQueries.latestResults, ScreenTextKeys.latestTitle, {
          id: "latest",
          description: ScreenTextKeys.latestDescription,
        }),
        {
          id: "history",
          kind: "relatedList",
          title: ScreenTextKeys.historyTitle,
          description: ScreenTextKeys.historyDescription,
          query: ReadinessQueries.runList,
          entity: "probe-run",
          columns: [
            {
              field: "requestedAt",
              label: ScreenTextKeys.columnStarted,
              renderer: { format: "timestamp", dateStyle: "medium", timeStyle: "short" },
            },
            { field: "triggeredByName", label: ScreenTextKeys.columnStartedBy },
            {
              field: "outcome",
              label: ScreenTextKeys.columnOutcome,
              renderer: {
                format: "enumOption",
                keyPrefix: RUN_OUTCOME_KEY_PREFIX,
                tones: { ok: "ok", failed: "bad", running: "neutral" },
              },
            },
            {
              field: "durationMs",
              label: ScreenTextKeys.columnDuration,
              valueType: "number",
              renderer: { format: "number" },
            },
          ],
          rowClick: { entity: "probe-run" },
          emptyState: { title: ScreenTextKeys.historyEmpty },
        },
      ],
    },
  };
}

export const systemCheckRunScreen: ProjectionDetailScreenDefinition = {
  id: SYSTEM_CHECK_RUN_SCREEN_ID,
  type: "projectionDetail",
  query: ReadinessQueries.runDetail,
  idParam: "runId",
  detailFor: "probe-run",
  live: true,
  dormant: true,
  listScreenId: SYSTEM_CHECK_SCREEN_ID,
  access: ACCESS,
  metrics: RESULT_METRICS,
  metricsStyle: "tiles",
  layout: {
    width: "full",
    sections: [
      resultsSection(ReadinessQueries.runResults, ScreenTextKeys.runResultsTitle, {
        parentParam: "runId",
      }),
    ],
  },
};
