import type { FeatureDefinition } from "../types/index.ts";
import { bootRuleError } from "./boot-rule.ts";
import { resolveScreenTargetQn } from "./screens-actions.ts";
import { DASHBOARD_RULES } from "./screens-dashboard-rules.ts";

export type DashboardPanelLinkTarget = {
  readonly screen: string;
  readonly namedFilter?: string;
};

// `where` names the option ("... list-panel "x" footerLink") so the one rule reads right for
// both the list footer and the stat-group link.
export function validateDashboardPanelLink(
  where: string,
  link: DashboardPanelLinkTarget | undefined,
  featureName: string,
  featureMap: ReadonlyMap<string, FeatureDefinition>,
): void {
  if (link === undefined) return;
  const qn = resolveScreenTargetQn(featureName, link.screen);
  const [targetFeatureName = "", , targetShortId = ""] = qn.split(":");
  const target = featureMap.get(targetFeatureName)?.screens[targetShortId];
  if (target === undefined) {
    throw bootRuleError(DASHBOARD_RULES.listFooterLinkUnknownScreen, {
      message: `${where} screen "${link.screen}" does not resolve to a registered screen (checked "${qn}"). Use a same-feature short id or a cross-feature QN "<feature>:screen:<id>".`,
    });
  }
  if (link.namedFilter === undefined) return;
  if (target.type !== "entityList" && target.type !== "projectionList") {
    throw bootRuleError(DASHBOARD_RULES.listFooterLinkUnknownScreen, {
      message: `${where} sets namedFilter "${link.namedFilter}" but screen "${target.id}" is not a list screen. Remove namedFilter.`,
    });
  }
  if (!(target.namedFilters ?? []).some((ref) => ref.id === link.namedFilter)) {
    throw bootRuleError(DASHBOARD_RULES.listFooterLinkUnknownScreen, {
      message: `${where} namedFilter "${link.namedFilter}" is not declared in namedFilters of screen "${target.id}". Add { id, label } to that screen.`,
    });
  }
}
