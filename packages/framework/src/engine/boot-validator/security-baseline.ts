import type { FeatureDefinition } from "../types";

export const SECURITY_BASELINE_FEATURE_NAMES = [
  "sessions",
  "crypto-shredding",
  "rate-limiting",
  "audit",
] as const;

export function warnOnMissingSecurityBaseline(
  features: readonly FeatureDefinition[],
  nodeEnv: string | undefined = process.env["NODE_ENV"],
): void {
  if (nodeEnv !== "production") return;

  const mountedNames = new Set(features.map((f) => f.name));
  const missing = SECURITY_BASELINE_FEATURE_NAMES.filter((name) => !mountedNames.has(name));
  if (missing.length === 0) return;

  // biome-ignore lint/suspicious/noConsole: boot-time hint, no logger available yet
  console.warn(
    `[kumiko:boot] NODE_ENV=production but the security baseline is incomplete — missing feature(s): ${missing.join(", ")}. Mount securityBaselineFeatures() from @cosmicdrift/kumiko-bundled-features/presets (or the missing features individually).`,
  );
}
