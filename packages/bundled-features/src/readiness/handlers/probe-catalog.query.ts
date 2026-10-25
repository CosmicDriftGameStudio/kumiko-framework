import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";
import { collectProbes } from "../collect-probes.ts";

export const probeCatalogQuery = defineQueryHandler({
  name: "probes:catalog",
  schema: z.object({}),
  access: { roles: ["TenantAdmin", "SystemAdmin"] },
  description:
    "Reports whether any probe the caller's system check would run is paid, so the start screen can offer the separate paid-checks action only when it matters.",
  handler: async (query, ctx) => {
    const probes = collectProbes(ctx.registry, {
      includeSystemProbes: query.user.roles.includes("SystemAdmin"),
      enabledFeatures: ctx.services.effectiveFeatures?.(query.user.tenantId),
    });
    return { hasPaidProbes: probes.some((probe) => probe.cost === "paid") };
  },
});
