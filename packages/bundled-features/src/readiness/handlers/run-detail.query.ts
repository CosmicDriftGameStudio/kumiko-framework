import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import { NotFoundError } from "@cosmicdrift/kumiko-framework/errors";
import * as z from "zod";
import { type RunRow, viewRun } from "../run-view.ts";
import { probeRunsTable } from "../schema/probe-run.ts";
import { toneOf } from "./run-tone.ts";

export const runDetailQuery = defineQueryHandler({
  name: "probe-run:detail",
  schema: z.object({ runId: z.uuid() }),
  access: { roles: ["TenantAdmin", "SystemAdmin"] },
  description:
    "Returns the header of one system-check run of the caller's tenant: status, timing, starter and the outcome counts of the results the caller may see.",
  handler: async (query, ctx) => {
    const run = await ctx.db.fetchOne<RunRow>(probeRunsTable, { id: query.payload.runId });
    if (!run) throw new NotFoundError("probe-run", query.payload.runId);
    const { counts, outcome } = viewRun(run, query.user);
    return {
      id: run.id,
      status: run.status,
      requestedAt: run.requestedAt.toString(),
      startedAt: run.startedAt?.toString() ?? null,
      finishedAt: run.finishedAt?.toString() ?? null,
      triggeredByUserId: run.triggeredByUserId,
      durationMs: run.durationMs,
      ...counts,
      outcome,
      tone: toneOf(outcome),
    };
  },
});
