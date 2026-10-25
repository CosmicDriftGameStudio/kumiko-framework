import {
  defineQueryHandler,
  pagedListSchema,
  pageRows,
} from "@cosmicdrift/kumiko-framework/engine";
import { HISTORY_LIMIT, type RunRow, viewRun } from "../run-view.ts";
import { probeRunsTable } from "../schema/probe-run.ts";

const SORT_FIELDS = ["requestedAt"] as const;

export const runListQuery = defineQueryHandler({
  name: "probe-run:list",
  schema: pagedListSchema(SORT_FIELDS),
  access: { roles: ["TenantAdmin", "SystemAdmin"] },
  description: `Lists the tenant's most recent system-check runs (up to ${HISTORY_LIMIT}), newest first, with starter, status, duration and the outcome counts of the results the caller may see.`,
  handler: async (query, ctx) => {
    const runs = await ctx.db.selectMany<RunRow>(
      probeRunsTable,
      {},
      { limit: HISTORY_LIMIT, orderBy: { col: "requestedAt", direction: "desc" } },
    );
    const rows = runs.map((run) => {
      const { counts, outcome } = viewRun(run, query.user);
      return {
        id: run.id,
        requestedAt: run.requestedAt.toString(),
        triggeredByUserId: run.triggeredByUserId,
        status: run.status,
        okCount: counts.okCount,
        failedCount: counts.failedCount,
        durationMs: run.durationMs,
        outcome,
      };
    });
    return pageRows(
      rows,
      { ...query.payload, sortDirection: query.payload.sortDirection ?? "desc" },
      { searchFields: ["requestedAt"], defaultSort: "requestedAt" },
    );
  },
});
