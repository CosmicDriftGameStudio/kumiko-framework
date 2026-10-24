import type { JobDefinition } from "@cosmicdrift/kumiko-types/config";
export const DEFAULT_MAX_PER_TENANT_DEFER_MS = 1_000;

export type ResolvedMaxPerTenant = {
  readonly limit: number;
  readonly onLimit: "skip" | "defer";
  readonly deferMs: number;
};

export function resolveMaxPerTenant(
  jobDef: Pick<JobDefinition, "maxPerTenant">,
): ResolvedMaxPerTenant | undefined {
  const raw = jobDef.maxPerTenant;
  if (raw === undefined) return undefined;
  if (typeof raw === "number") {
    return { limit: raw, onLimit: "skip", deferMs: DEFAULT_MAX_PER_TENANT_DEFER_MS };
  }
  return {
    limit: raw.limit,
    onLimit: raw.onLimit,
    deferMs: raw.deferMs ?? DEFAULT_MAX_PER_TENANT_DEFER_MS,
  };
}
