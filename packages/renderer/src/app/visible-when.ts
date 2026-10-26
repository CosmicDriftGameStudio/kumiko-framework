import type {
  DashboardPanelVisibility,
  ScreenFallbackReason,
} from "@cosmicdrift/kumiko-framework/ui-types";
import type { UseQueryResult } from "../hooks/use-query.ts";

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

// Once the content was shown, a failed refetch must not unmount it (and drop unsaved
// form input) while the last good data still matches; the first evaluation stays fail-closed.
export function evalVisibleWhenAfterShown(
  visibleWhen: DashboardPanelVisibility,
  result: UseQueryResult<Readonly<Record<string, unknown>>> | undefined,
  wasShown: boolean,
): VisibleWhenVerdict {
  const verdict = evalVisibleWhen(visibleWhen, result);
  const lastGoodDataMatches = result?.data?.[visibleWhen.field] === visibleWhen.eq;
  return verdict === "error" && wasShown && lastGoodDataMatches ? "visible" : verdict;
}

export type FailedVerdict = Exclude<VisibleWhenVerdict, "visible" | "loading">;

// Splits a closed gate by cause so a screen's `fallback` map can answer "not allowed" and
// "gone" differently from "condition unmet" and "something broke".
export function screenFallbackReason(
  verdict: FailedVerdict,
  error: { readonly httpStatus: number } | null,
): ScreenFallbackReason {
  if (verdict === "hidden") return "hidden";
  if (error?.httpStatus === 403) return "forbidden";
  if (error?.httpStatus === 404) return "notFound";
  return "error";
}
