import type { ProbeDefinition, Registry } from "@cosmicdrift/kumiko-framework/engine";
import {
  DEFAULT_PROBE_TIMEOUT_MS,
  MIN_STALE_RUN_AFTER_MS,
  STALE_RUN_TIMEOUT_FACTOR,
} from "./constants.ts";

export type CollectProbesOptions = {
  readonly includeSystemProbes: boolean;
  // Feature names enabled for the tenant; undefined = every mounted feature.
  readonly enabledFeatures: ReadonlySet<string> | undefined;
};

export function collectProbes(
  registry: Registry,
  options: CollectProbesOptions,
): readonly ProbeDefinition[] {
  const collected: ProbeDefinition[] = [];
  for (const feature of registry.features.values()) {
    if (options.enabledFeatures !== undefined && !options.enabledFeatures.has(feature.name)) {
      continue;
    }
    for (const probe of Object.values(feature.probes ?? {})) {
      if (probe.scope === "system" && !options.includeSystemProbes) continue;
      collected.push(probe);
    }
  }
  return collected;
}

export function hasPaidProbes(registry: Registry, options: CollectProbesOptions): boolean {
  return collectProbes(registry, options).some((probe) => probe.cost === "paid");
}

export function probeTimeoutMs(probe: ProbeDefinition): number {
  return probe.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
}

export function staleRunAfterMs(registry: Registry): number {
  let longestTimeoutMs = 0;
  for (const feature of registry.features.values()) {
    for (const probe of Object.values(feature.probes ?? {})) {
      longestTimeoutMs = Math.max(longestTimeoutMs, probeTimeoutMs(probe));
    }
  }
  return Math.max(MIN_STALE_RUN_AFTER_MS, longestTimeoutMs * STALE_RUN_TIMEOUT_FACTOR);
}
