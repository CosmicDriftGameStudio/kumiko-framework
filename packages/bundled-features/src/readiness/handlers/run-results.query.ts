import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import { NotFoundError } from "@cosmicdrift/kumiko-framework/errors";
import * as z from "zod";
import { type RunRow, viewRun } from "../run-view.ts";
import { probeRunsTable } from "../schema/probe-run.ts";

export const runResultsQuery = defineQueryHandler({
  name: "probe-run:results",
  schema: z.object({ runId: z.uuid() }),
  access: { roles: ["TenantAdmin", "SystemAdmin"] },
  description:
    "Returns the per-probe results of one system-check run of the caller's tenant, filtered to what the caller may see: system probes only for SystemAdmin, personal mailboxes only for their owner.",
  handler: async (query, ctx) => {
    const run = await ctx.db.fetchOne<RunRow>(probeRunsTable, { id: query.payload.runId });
    if (!run) throw new NotFoundError("probe-run", query.payload.runId);
    return { rows: viewRun(run, query.user).results, nextCursor: null };
  },
});
