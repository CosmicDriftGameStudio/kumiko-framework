import {
  defineQueryHandler,
  pagedListSchema,
  pageRows,
} from "@cosmicdrift/kumiko-framework/engine";
import { resolveUserDisplayNames, USER_FEATURE } from "../../user/index.ts";
import { HISTORY_LIMIT, type RunRow, viewRun } from "../run-view.ts";
import { probeRunsTable } from "../schema/probe-run.ts";

const SORT_FIELDS = ["requestedAt"] as const;

export const runListQuery = defineQueryHandler({
  name: "probe-run:list",
  schema: pagedListSchema(SORT_FIELDS),
  access: { roles: ["TenantAdmin", "SystemAdmin"] },
  description: `Lists the tenant's most recent system-check runs (up to ${HISTORY_LIMIT}), newest first, with starter (display name when the user feature is mounted), status, duration and the outcome counts of the results the caller may see.`,
  handler: async (query, ctx) => {
    const runs = await ctx.db.selectMany<RunRow>(
      probeRunsTable,
      {},
      { limit: HISTORY_LIMIT, orderBy: { col: "requestedAt", direction: "desc" } },
    );
    const starterIds = [...new Set(runs.map((run) => run.triggeredByUserId))];
    const starterNames =
      ctx.registry.getFeature(USER_FEATURE) === undefined
        ? new Map<string, string>()
        : await resolveUserDisplayNames(ctx.db, starterIds);
    const rows = runs.map((run) => {
      const { counts, outcome } = viewRun(run, query.user);
      return {
        id: run.id,
        // Fixed width: pageRows sorts this as a string, and a trimmed fraction ("…20Z" vs "…20.001Z") sorts wrong.
        requestedAt: run.requestedAt.toString({ fractionalSecondDigits: 6 }),
        triggeredByUserId: run.triggeredByUserId,
        triggeredByName: starterNames.get(run.triggeredByUserId) ?? run.triggeredByUserId,
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
