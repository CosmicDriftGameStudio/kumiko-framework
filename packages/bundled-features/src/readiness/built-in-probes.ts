import type { FeatureRegistrar, ProbeContext } from "@cosmicdrift/kumiko-framework/engine";
import { ProbeTextKeys } from "./constants.ts";
import { probeRunsTable } from "./schema/probe-run.ts";

export const BuiltInProbeKeys = {
  areaInfrastructure: "readiness.area.infrastructure",
  databaseLabel: "readiness.probe.database.label",
  databaseOk: "readiness.probe.database.ok",
  cacheLabel: "readiness.probe.cache.label",
  cacheOk: "readiness.probe.cache.ok",
  searchLabel: "readiness.probe.search.label",
  searchOk: "readiness.probe.search.ok",
} as const;

export function registerBuiltInProbes(r: FeatureRegistrar<"readiness">): void {
  r.probe({
    name: "database",
    scope: "system",
    cost: "free",
    area: BuiltInProbeKeys.areaInfrastructure,
    label: BuiltInProbeKeys.databaseLabel,
    run: async (ctx: ProbeContext) => {
      await ctx.db.fetchOne(probeRunsTable, { id: ctx.probeRunId });
      return { status: "ok", message: { key: BuiltInProbeKeys.databaseOk } };
    },
  });

  r.probe({
    name: "cache",
    scope: "system",
    cost: "free",
    area: BuiltInProbeKeys.areaInfrastructure,
    label: BuiltInProbeKeys.cacheLabel,
    run: async (ctx: ProbeContext) => {
      const { redis } = ctx.services;
      if (!redis) return { status: "skipped", message: { key: ProbeTextKeys.notConfigured } };
      const reply = await redis.ping();
      if (reply !== "PONG") throw new Error(`unexpected PING reply: ${reply}`);
      return { status: "ok", message: { key: BuiltInProbeKeys.cacheOk } };
    },
  });

  r.probe({
    name: "search",
    scope: "system",
    cost: "free",
    area: BuiltInProbeKeys.areaInfrastructure,
    label: BuiltInProbeKeys.searchLabel,
    run: async (ctx: ProbeContext) => {
      const { searchAdapter } = ctx.services;
      if (!searchAdapter) {
        return { status: "skipped", message: { key: ProbeTextKeys.notConfigured } };
      }
      await searchAdapter.search(ctx.tenantId, "readiness-probe", { limit: 1 });
      return { status: "ok", message: { key: BuiltInProbeKeys.searchOk } };
    },
  });
}
