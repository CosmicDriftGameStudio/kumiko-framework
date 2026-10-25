import { buildEntityTable, sql } from "@cosmicdrift/kumiko-framework/db";
import type { ProbeScope, ProbeText } from "@cosmicdrift/kumiko-framework/engine";
import {
  createBooleanField,
  createEntity,
  createJsonbField,
  createNumberField,
  createSelectField,
  createTextField,
  createTimestampField,
} from "@cosmicdrift/kumiko-framework/engine";

export const PROBE_RUN_STATUS = {
  Pending: "pending",
  Running: "running",
  Done: "done",
  Abandoned: "abandoned",
} as const;

export type ProbeRunStatus = (typeof PROBE_RUN_STATUS)[keyof typeof PROBE_RUN_STATUS];

export const ACTIVE_PROBE_RUN_CONSTRAINT = "read_readiness_probe_runs_one_active_per_tenant";

const PROBE_RUN_STATUS_OPTIONS = [
  PROBE_RUN_STATUS.Pending,
  PROBE_RUN_STATUS.Running,
  PROBE_RUN_STATUS.Done,
  PROBE_RUN_STATUS.Abandoned,
] as const;

export type ProbeResultStatus = "ok" | "failed" | "skipped";

// Texts are i18n keys plus short scalar params, never raw error messages or addresses.
export type ProbeResultRow = {
  readonly probe: string;
  readonly scope: ProbeScope;
  readonly area: string;
  readonly label: ProbeText;
  readonly targetId?: string;
  readonly ownerUserId?: string;
  readonly status: ProbeResultStatus;
  readonly durationMs: number | null;
  readonly message: ProbeText;
  readonly fixScreen?: string;
};

// A jsonb field only accepts a plain object at the write boundary, so the rows sit under one key.
export type ProbeRunResults = { readonly rows: readonly ProbeResultRow[] };

export const probeRunEntity = createEntity({
  table: "read_readiness_probe_runs",
  idType: "uuid",
  description:
    "One system-check run of a tenant: who started it, whether paid and system probes were requested, its pending/running/done/abandoned status, the timing and the per-probe results with their translated texts and outcome counts.",

  fields: {
    status: createSelectField({
      required: true,
      default: PROBE_RUN_STATUS.Pending,
      options: PROBE_RUN_STATUS_OPTIONS,
    }),
    includePaid: createBooleanField({}),
    includeSystemProbes: createBooleanField({}),
    triggeredByUserId: createTextField({
      required: true,
      personal: false,
      reason: "pseudonymous_fk",
    }),
    requestedAt: createTimestampField({ required: true, sortable: true }),
    startedAt: createTimestampField({}),
    finishedAt: createTimestampField({}),
    durationMs: createNumberField({ integer: true }),
    okCount: createNumberField({ integer: true }),
    failedCount: createNumberField({ integer: true }),
    skippedCount: createNumberField({ integer: true }),
    results: createJsonbField({ personal: false, reason: "is_business_data" }),
  },

  indexes: [
    {
      unique: true,
      columns: ["tenantId"],
      name: ACTIVE_PROBE_RUN_CONSTRAINT,
      where: sql`status IN ('pending', 'running')`,
    },
  ],
});

export const probeRunsTable = buildEntityTable("probeRun", probeRunEntity);
