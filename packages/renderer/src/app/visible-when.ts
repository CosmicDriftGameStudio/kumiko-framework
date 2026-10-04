import type { DashboardPanelVisibility } from "@cosmicdrift/kumiko-framework/ui-types";
import type { UseQueryResult } from "../hooks/use-query.js";

export type VisibleWhenVerdict = "loading" | "visible" | "hidden" | "error";

// Shared by dashboard screen panels and screen-level visibleWhen. Anything but a
// positive match is non-visible (fail-closed); `error` is split out so panels can offer a retry.
export function evalVisibleWhen(
  visibleWhen: DashboardPanelVisibility,
  result: UseQueryResult<Readonly<Record<string, unknown>>> | undefined,
): VisibleWhenVerdict {
  if (result?.error) return "error";
  if (result === undefined) return "hidden";
  if (result.data === null) return result.loading ? "loading" : "hidden";
  return result.data[visibleWhen.field] === visibleWhen.eq ? "visible" : "hidden";
}
