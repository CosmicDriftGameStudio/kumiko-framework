import type { ProbeCost, ProbeOptions, ProbeScope } from "@cosmicdrift/kumiko-types/probe";
import type { FeatureBuilderState } from "./feature-builder-state.ts";
import { isKebabSegment, QnTypes, qn, toKebab } from "./qualified-name.ts";

const PROBE_SCOPES: readonly ProbeScope[] = ["tenant", "system"];
const PROBE_COSTS: readonly ProbeCost[] = ["free", "paid"];

function assertValidProbe(featureName: string, options: ProbeOptions): void {
  const prefix = `[Feature ${featureName}] r.probe()`;
  if (typeof options.name !== "string" || options.name.length === 0) {
    throw new Error(`${prefix}: name must be a non-empty string`);
  }
  if (!isKebabSegment(options.name)) {
    throw new Error(`${prefix}: name "${options.name}" must be kebab-case`);
  }
  if (!PROBE_SCOPES.includes(options.scope)) {
    throw new Error(`${prefix} "${options.name}": scope must be one of ${PROBE_SCOPES.join(", ")}`);
  }
  if (!PROBE_COSTS.includes(options.cost)) {
    throw new Error(`${prefix} "${options.name}": cost must be one of ${PROBE_COSTS.join(", ")}`);
  }
  for (const field of ["area", "label"] as const) {
    if (typeof options[field] !== "string" || options[field].length === 0) {
      throw new Error(`${prefix} "${options.name}": ${field} must be a non-empty i18n key`);
    }
  }
  if (options.timeoutMs !== undefined && !(options.timeoutMs > 0)) {
    throw new Error(`${prefix} "${options.name}": timeoutMs must be > 0`);
  }
  if (typeof options.run !== "function") {
    throw new Error(`${prefix} "${options.name}": run must be a function`);
  }
  if (options.targets !== undefined && typeof options.targets !== "function") {
    throw new Error(`${prefix} "${options.name}": targets must be a function`);
  }
}

export function buildProbeMethods(state: FeatureBuilderState, featureName: string) {
  return {
    probe(options: ProbeOptions): void {
      assertValidProbe(featureName, options);
      if (state.probes[options.name]) {
        throw new Error(
          `[Feature ${featureName}] Probe "${options.name}" already registered. Probe names must be unique per feature.`,
        );
      }
      state.probes[options.name] = {
        ...options,
        qualifiedName: qn(toKebab(featureName), QnTypes.probe, options.name),
      };
    },
  };
}
