import type { DashboardRefresh } from "@cosmicdrift/kumiko-framework/ui-types";
import { DASHBOARD_MIN_REFRESH_SECONDS } from "@cosmicdrift/kumiko-types/screen";

// setInterval treats anything above a signed 32-bit int as 0 ms and would fire in a tight loop.
const MAX_TIMER_MS = 2_147_483_647;

/** Polling interval of a dashboard in ms; undefined means no polling. A record
 *  field that is missing, not a positive number or not loaded yet disables it
 *  until a valid value arrives. The result never drops below
 *  DASHBOARD_MIN_REFRESH_SECONDS, whatever the record says. */
export function resolveRefreshIntervalMs(
  refresh: DashboardRefresh | undefined,
  record: Readonly<Record<string, unknown>> | null,
): number | undefined {
  if (refresh === undefined) return undefined;
  const seconds = "seconds" in refresh ? refresh.seconds : record?.[refresh.field];
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) return undefined;
  return Math.min(Math.max(seconds, DASHBOARD_MIN_REFRESH_SECONDS) * 1000, MAX_TIMER_MS);
}
