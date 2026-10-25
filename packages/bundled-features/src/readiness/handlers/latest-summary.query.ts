import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";
import { fetchLatestRun, viewRun } from "../run-view.ts";
import { toneOf } from "./run-tone.ts";

export const SUMMARY_TEXT_KEY = "readiness.summary.ok-of-total";
export const SUMMARY_RUNNING_TEXT_KEY = "readiness.summary.running";

export const latestSummaryQuery = defineQueryHandler({
  name: "probe-run:latest-summary",
  schema: z.object({}),
  access: { roles: ["TenantAdmin", "SystemAdmin"] },
  description:
    "Returns the one-line summary of the tenant's latest system-check run (when it started, how many of the checks the caller may see passed, a tone and a ready-made translatable text), or an empty object when no run exists yet.",
  handler: async (query, ctx) => {
    const latest = await fetchLatestRun(ctx.db);
    if (!latest) return {};
    const { counts, outcome } = viewRun(latest, query.user);
    return {
      requestedAt: latest.requestedAt.toString(),
      status: latest.status,
      ...counts,
      outcome,
      tone: toneOf(outcome),
      text:
        outcome === "running"
          ? { i18nKey: SUMMARY_RUNNING_TEXT_KEY }
          : {
              i18nKey: SUMMARY_TEXT_KEY,
              i18nParams: { ok: counts.okCount, total: counts.totalCount },
            },
    };
  },
});
