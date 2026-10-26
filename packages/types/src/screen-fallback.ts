/** Why a screen gate is not open. `hidden`: the gate query answered but the condition is unmet
 *  (also a missing route id with `idParam`); `forbidden`/`notFound`: the gate query failed with
 *  HTTP 403/404; `error`: any other failure. */
export type ScreenFallbackReason = "hidden" | "forbidden" | "notFound" | "error";

/** Per-reason fallback screens (same-feature short id or cross-feature QN). A reason without an
 *  entry gets the default notice. At least one key is required. */
export type ScreenFallbackByReason = {
  readonly [Reason in ScreenFallbackReason]?: string;
};

/** Screen-level `fallback`: one screen for every reason, or one per reason. */
export type ScreenFallback = string | ScreenFallbackByReason;

export const SCREEN_FALLBACK_REASONS: readonly ScreenFallbackReason[] = [
  "hidden",
  "forbidden",
  "notFound",
  "error",
];

/** The fallback screen for one reason, or undefined when the map has no entry for it. */
export function fallbackTargetFor(
  fallback: ScreenFallback,
  reason: ScreenFallbackReason,
): string | undefined {
  return typeof fallback === "string" ? fallback : fallback[reason];
}

/** Every screen a fallback can render, in reason order. */
export function fallbackTargets(fallback: ScreenFallback): readonly string[] {
  if (typeof fallback === "string") return [fallback];
  return SCREEN_FALLBACK_REASONS.flatMap((reason) => fallback[reason] ?? []);
}
