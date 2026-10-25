import { createEventStoreExecutor } from "@cosmicdrift/kumiko-framework/db";
import { createSystemUser, type JobContext } from "@cosmicdrift/kumiko-framework/engine";
import { collectProbes } from "./collect-probes.ts";
import { ProbeTextKeys } from "./constants.ts";
import { executeProbes } from "./execute-probes.ts";
import { buildProbeContext } from "./probe-context.ts";
import {
  PROBE_RUN_STATUS,
  type ProbeResultRow,
  probeRunEntity,
  probeRunsTable,
} from "./schema/probe-run.ts";

const crud = createEventStoreExecutor(probeRunsTable, probeRunEntity, {
  entityName: "probe-run",
});

type PendingRunRow = {
  readonly id: string;
  readonly version: number;
  readonly includePaid: boolean;
  readonly includeSystemProbes: boolean;
  readonly triggeredByUserId: string;
};

function countStatus(rows: readonly ProbeResultRow[], status: ProbeResultRow["status"]): number {
  return rows.filter((row) => row.status === status).length;
}

// Runs the pending run of the job's tenant; the write handler guarantees at most one active run per tenant.
export async function runProbesJob(_payload: Record<string, unknown>, ctx: JobContext) {
  const tenantId = ctx.db.tenantId;
  const run = await ctx.db.fetchOne<PendingRunRow>(probeRunsTable, {
    status: PROBE_RUN_STATUS.Pending,
  });
  // skip: no pending run left, e.g. a second trigger after the first job already claimed it.
  if (!run) return;

  const executor = createSystemUser(tenantId);
  const startedAt = ctx.tz.now();
  const claimed = await crud.update(
    {
      id: run.id,
      version: run.version,
      changes: { status: PROBE_RUN_STATUS.Running, startedAt },
    },
    executor,
    ctx.db,
  );
  // skip: a second job for the same run claimed it first
  if (!claimed.isSuccess) return;

  let rows: readonly ProbeResultRow[] = [];
  try {
    const probes = collectProbes(ctx.registry, {
      includeSystemProbes: run.includeSystemProbes,
      enabledFeatures: ctx.services.effectiveFeatures?.(tenantId),
    });
    const probeContext = await buildProbeContext(ctx, run, tenantId);
    rows = await executeProbes(probeContext, probes, run.includePaid);
  } catch (error) {
    ctx.obs.log.warn("readiness run crashed", {
      runId: run.id,
      error: error instanceof Error ? error.message : String(error),
    });
    rows = [
      ...rows,
      {
        probe: "readiness:probe:run",
        scope: "tenant",
        area: "readiness.area.run",
        label: { key: "readiness.probe.run" },
        status: "failed",
        durationMs: null,
        message: { key: ProbeTextKeys.runCrashed },
      },
    ];
  } finally {
    const finishedAt = ctx.tz.now();
    const done = await crud.update(
      {
        id: run.id,
        version: run.version + 1,
        changes: {
          status: PROBE_RUN_STATUS.Done,
          finishedAt,
          durationMs: finishedAt.epochMilliseconds - startedAt.epochMilliseconds,
          okCount: countStatus(rows, "ok"),
          failedCount: countStatus(rows, "failed"),
          skippedCount: countStatus(rows, "skipped"),
          results: { rows },
        },
      },
      executor,
      ctx.db,
    );
    if (!done.isSuccess) {
      ctx.obs.log.warn("readiness run could not be finished", {
        runId: run.id,
        code: done.error.code,
      });
    }
  }
}
