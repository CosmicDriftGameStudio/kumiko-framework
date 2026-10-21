import {
  type ActionFormScreenDefinition,
  i18nKey,
  type ProjectionDetailScreenDefinition,
  type ProjectionListScreenDefinition,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  CONSUMER_INSTANCE_OPTION_KEY_PREFIX,
  CONSUMER_STATUS_OPTION_KEY_PREFIX,
  CONSUMER_STATUSES,
  EVENT_CONSUMER_DETAIL_SCREEN_ID,
  EVENT_CONSUMERS_SCREEN_ID,
  JOB_RUN_DETAIL_SCREEN_ID,
  JOB_RUNS_SCREEN_ID,
  JobHandlers,
  JobQueries,
} from "./web/constants.ts";

const systemAdminAccess = { roles: ["SystemAdmin"] as const };

export const jobRunsScreen: ProjectionListScreenDefinition = {
  id: JOB_RUNS_SCREEN_ID,
  type: "projectionList",
  query: JobQueries.list,
  columns: [
    { field: "jobName", label: i18nKey("jobs.runs.col.job") },
    { field: "status", label: i18nKey("jobs.runs.col.status") },
    {
      field: "startedAt",
      label: i18nKey("jobs.runs.col.started"),
      renderer: { format: "timestamp" },
    },
    { field: "duration", label: i18nKey("jobs.runs.col.duration") },
  ],
  defaultSort: { field: "startedAt", dir: "desc" },
  facets: [
    {
      field: "status",
      type: "select",
      label: i18nKey("jobs.runs.filter.status"),
      options: [
        { value: "queued", label: i18nKey("jobs.runs.filter.queued") },
        { value: "running", label: i18nKey("jobs.runs.filter.running") },
        { value: "completed", label: i18nKey("jobs.runs.filter.completed") },
        { value: "failed", label: i18nKey("jobs.runs.filter.failed") },
      ],
    },
  ],
  rowActions: [
    {
      kind: "navigate",
      id: "open",
      label: i18nKey("jobs.runs.open"),
      screen: JOB_RUN_DETAIL_SCREEN_ID,
      entityId: "id",
      rowClick: true,
    },
  ],
  toolbarActions: [
    {
      kind: "drawer",
      id: "trigger",
      label: i18nKey("jobs.trigger.title"),
      screen: "job-trigger",
      style: "primary",
    },
  ],
  pagination: "infinite",
  access: systemAdminAccess,
};

export const jobTriggerScreen: ActionFormScreenDefinition = {
  id: "job-trigger",
  type: "actionForm",
  handler: JobHandlers.trigger,
  fields: {
    jobName: { type: "text", required: true },
    payload: { type: "longText", multiline: true, default: "{}" },
  },
  layout: { sections: [{ fields: ["jobName", "payload"] }] },
  submitLabel: i18nKey("jobs.trigger.submit"),
  access: systemAdminAccess,
  description: "jobs.screen.job-trigger.subtitle",
};

export const jobRunDetailScreen: ProjectionDetailScreenDefinition = {
  id: JOB_RUN_DETAIL_SCREEN_ID,
  type: "projectionDetail",
  query: JobQueries.details,
  idParam: "runId",
  fieldLabels: {
    jobName: i18nKey("jobs.detail.field.job"),
    status: i18nKey("jobs.detail.field.status"),
    id: i18nKey("jobs.detail.field.id"),
    startedAt: i18nKey("jobs.detail.field.started"),
    finishedAt: i18nKey("jobs.detail.field.finished"),
    duration: i18nKey("jobs.detail.field.duration"),
    error: i18nKey("jobs.detail.field.error"),
    logs: i18nKey("jobs.detail.logs"),
  },
  layout: {
    sections: [
      {
        fields: [
          "jobName",
          "status",
          "id",
          { field: "startedAt", renderer: { format: "timestamp" } },
          { field: "finishedAt", renderer: { format: "timestamp" } },
          "duration",
          "error",
        ],
      },
      // No section `title` here (label-dedup fix): the section
      // holds exactly one field, so a title would repeat the field's own
      // label (rendered by RenderField as the Field's heading) verbatim.
      {
        fields: [{ field: "logs", renderer: { format: "json" } }],
      },
    ],
  },
  actions: [
    {
      kind: "writeHandler",
      id: "retry",
      label: i18nKey("jobs.detail.retry"),
      handler: JobHandlers.retry,
      payload: { map: { runId: "id" } },
      visible: { field: "status", eq: "failed" },
      style: "primary",
    },
  ],
  description: "jobs.screen.job-run-detail.subtitle",
  listScreenId: JOB_RUNS_SCREEN_ID,
  access: systemAdminAccess,
};

export const eventConsumersScreen: ProjectionListScreenDefinition = {
  id: EVENT_CONSUMERS_SCREEN_ID,
  type: "projectionList",
  query: JobQueries.consumers,
  columns: [
    { field: "name", label: i18nKey("jobs.consumers.col.name") },
    {
      field: "status",
      label: i18nKey("jobs.consumers.col.status"),
      renderer: { format: "enumOption", keyPrefix: CONSUMER_STATUS_OPTION_KEY_PREFIX },
    },
    { field: "lag", label: i18nKey("jobs.consumers.col.lag"), hideOnNarrow: true },
    { field: "attempts", label: i18nKey("jobs.consumers.col.attempts"), hideOnNarrow: true },
    { field: "lastError", label: i18nKey("jobs.consumers.col.lastError") },
  ],
  defaultSort: { field: "status", dir: "asc" },
  facets: [
    {
      field: "status",
      type: "select",
      label: i18nKey("jobs.consumers.col.status"),
      options: CONSUMER_STATUSES.map((status) => ({
        value: status,
        label: i18nKey(`${CONSUMER_STATUS_OPTION_KEY_PREFIX}${status}`),
      })),
    },
  ],
  rowActions: [
    {
      kind: "navigate",
      id: "open",
      label: i18nKey("jobs.runs.open"),
      screen: EVENT_CONSUMER_DETAIL_SCREEN_ID,
      entityId: "id",
      rowClick: true,
    },
  ],
  pagination: "infinite",
  access: systemAdminAccess,
  description: "jobs.screen.event-consumers.subtitle",
};

export const eventConsumerDetailScreen: ProjectionDetailScreenDefinition = {
  id: EVENT_CONSUMER_DETAIL_SCREEN_ID,
  type: "projectionDetail",
  query: JobQueries.consumerDetails,
  idParam: "consumerId",
  fieldLabels: {
    name: i18nKey("jobs.consumers.col.name"),
    instanceId: i18nKey("jobs.consumers.field.instanceId"),
    status: i18nKey("jobs.consumers.col.status"),
    lag: i18nKey("jobs.consumers.col.lag"),
    attempts: i18nKey("jobs.consumers.col.attempts"),
    lastError: i18nKey("jobs.consumers.col.lastError"),
    updatedAt: i18nKey("jobs.consumers.field.updatedAt"),
  },
  layout: {
    sections: [
      {
        fields: [
          "name",
          {
            field: "instanceId",
            renderer: { format: "enumOption", keyPrefix: CONSUMER_INSTANCE_OPTION_KEY_PREFIX },
          },
          {
            field: "status",
            renderer: { format: "enumOption", keyPrefix: CONSUMER_STATUS_OPTION_KEY_PREFIX },
          },
          "lag",
          "attempts",
          { field: "updatedAt", renderer: { format: "timestamp" } },
        ],
      },
      { fields: ["lastError"] },
    ],
  },
  actions: [
    {
      kind: "writeHandler",
      id: "restart",
      icon: "refresh",
      label: i18nKey("jobs.consumers.restart"),
      handler: JobHandlers.consumerRestart,
      payload: { map: { name: "name", instanceId: "instanceId" } },
      visible: { field: "status", eq: "dead" },
      style: "primary",
    },
    {
      kind: "writeHandler",
      id: "skip",
      icon: "arrow-right",
      label: i18nKey("jobs.consumers.skip"),
      handler: JobHandlers.consumerSkip,
      payload: { map: { name: "name", instanceId: "instanceId" } },
      visible: { field: "status", eq: "dead" },
      confirm: i18nKey("jobs.consumers.skip.confirm"),
      style: "danger",
    },
    {
      kind: "writeHandler",
      id: "disable",
      icon: "x",
      label: i18nKey("jobs.consumers.disable"),
      handler: JobHandlers.consumerDisable,
      payload: { map: { name: "name", instanceId: "instanceId" } },
      visible: { field: "status", ne: "disabled" },
      style: "secondary",
    },
    {
      kind: "writeHandler",
      id: "enable",
      icon: "check",
      label: i18nKey("jobs.consumers.enable"),
      handler: JobHandlers.consumerEnable,
      payload: { map: { name: "name", instanceId: "instanceId" } },
      visible: { field: "status", eq: "disabled" },
      style: "primary",
    },
  ],
  primaryAction: "restart",
  description: "jobs.screen.event-consumer-detail.subtitle",
  listScreenId: EVENT_CONSUMERS_SCREEN_ID,
  access: systemAdminAccess,
};
