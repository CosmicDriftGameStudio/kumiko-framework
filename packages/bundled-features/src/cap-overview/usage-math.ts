// @runtime client
// Pure math with no runtime deps — both the query handlers (runtime → client
// is allowed by the compat matrix) and cap-usage-bar.tsx (client → client)
// import it.
import type { CapUsageTone } from "./types";

const WARN_THRESHOLD = 0.8;
const DANGER_THRESHOLD = 1;

// limit === null means unlimited (no cap to measure against); limit <= 0
// means "not part of this tier" — both render as 0, never NaN/Infinity.
function rawFraction(used: number, limit: number | null): number {
  if (limit === null) return 0;
  if (limit <= 0) return 0;
  const fraction = used / limit;
  return Number.isFinite(fraction) ? fraction : 0;
}

export function computeFraction(used: number, limit: number | null): number {
  return Math.min(1, Math.max(0, rawFraction(used, limit)));
}

// Unclamped — for display of the over-limit case (e.g. "140%"). Bar width
// and tone still use the clamped computeFraction; only percent shows the
// real ratio.
export function computeUnclampedFraction(used: number, limit: number | null): number {
  return rawFraction(used, limit);
}

export function computeTone(fraction: number): CapUsageTone {
  if (fraction >= DANGER_THRESHOLD) return "danger";
  if (fraction >= WARN_THRESHOLD) return "warn";
  return "default";
}
