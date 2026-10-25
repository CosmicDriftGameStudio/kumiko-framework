import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";
import { fetchLatestRun, viewRun } from "../run-view.ts";

export const latestResultsQuery = defineQueryHandler({
  name: "probe-run:latest-results",
  schema: z.object({}),
  access: { roles: ["TenantAdmin", "SystemAdmin"] },
  description:
    "Returns the per-probe results of the tenant's latest system-check run (finished or still running) that the caller may see: system probes only for SystemAdmin, personal mailboxes only for their owner. Empty rows while the run is still working or when no run exists.",
  handler: async (query, ctx) => {
    const latest = await fetchLatestRun(ctx.db);
    return { rows: latest ? viewRun(latest, query.user).results : [] };
  },
});
