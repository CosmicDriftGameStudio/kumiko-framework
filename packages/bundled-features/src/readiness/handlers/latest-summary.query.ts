import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";
import { hasPaidProbes } from "../collect-probes.ts";
import { fetchLatestRun, viewRun } from "../run-view.ts";
import { countResults } from "../visible-results.ts";
import { toneOf } from "./run-tone.ts";

export const SUMMARY_TEXT_KEY = "readiness.summary.ok-of-total";
export const SUMMARY_RUNNING_TEXT_KEY = "readiness.summary.running";
export const SUMMARY_NO_RUN_TEXT_KEY = "readiness.summary.no-run";

export const latestSummaryQuery = defineQueryHandler({
  name: "probe-run:latest-summary",
  schema: z.object({}),
  access: { roles: ["TenantAdmin", "SystemAdmin"] },
  description:
    "Returns the one-line summary of the tenant's latest system-check run (when it started, how many of the checks the caller may see passed, a tone and a ready-made translatable text) and whether the caller's check has paid probes. Zero counts and runId null when no run exists yet.",
  handler: async (query, ctx) => {
    const paid = hasPaidProbes(ctx.registry, {
      includeSystemProbes: query.user.roles.includes("SystemAdmin"),
      enabledFeatures: ctx.services.effectiveFeatures?.(query.user.tenantId),
    });
    const latest = await fetchLatestRun(ctx.db);
    if (!latest) {
      return {
        // The system-check screen's record id only gates its sections; their queries ignore it.
        id: query.user.tenantId,
        runId: null,
        hasPaidProbes: paid,
        ...countResults([]),
        text: { i18nKey: SUMMARY_NO_RUN_TEXT_KEY },
      };
    }
    const { counts, outcome } = viewRun(latest, query.user);
    return {
      id: latest.id,
      runId: latest.id,
      hasPaidProbes: paid,
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
