import type { DashboardPanelDefinition } from "@cosmicdrift/kumiko-framework/ui-types";

/** Under sm panels follow `narrowOrder` (default 0); `toSorted` is stable, so equal values keep the declared order. */
export function panelsInNarrowOrder(
  panels: readonly DashboardPanelDefinition[],
  belowSm: boolean,
): readonly DashboardPanelDefinition[] {
  if (!belowSm) return panels;
  return panels.toSorted((a, b) => (a.narrowOrder ?? 0) - (b.narrowOrder ?? 0));
}
