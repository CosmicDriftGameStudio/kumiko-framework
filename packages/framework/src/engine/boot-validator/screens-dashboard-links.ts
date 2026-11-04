import type { FeatureDefinition } from "../types/index.ts";
import { bootRuleError } from "./boot-rule.ts";
import { declaredNamedFilterIds, resolveDashboardScreenTarget } from "./dashboard-screen-target.ts";
import { validateNavigateParams } from "./dashboard-stat-navigate.ts";
import { DASHBOARD_RULES } from "./screens-dashboard-rules.ts";

export type DashboardPanelLinkTarget = {
  readonly screen: string;
  readonly namedFilter?: string;
  readonly params?: Readonly<Record<string, unknown>>;
};

// A rowLink naming its target per row (screenField) has nothing to resolve at boot.
export function validateListRowLinkTarget(
  where: string,
  rowLink: { readonly screen?: string | undefined } | undefined,
  featureName: string,
  featureMap: ReadonlyMap<string, FeatureDefinition>,
): void {
  if (rowLink?.screen === undefined) return;
  validateDashboardPanelLink(where, { screen: rowLink.screen }, featureName, featureMap);
}

// `where` names the option ("... list-panel "x" footerLink") so the one rule reads right for
// both the list footer and the stat-group link.
export function validateDashboardPanelLink(
  where: string,
  link: DashboardPanelLinkTarget | undefined,
  featureName: string,
  featureMap: ReadonlyMap<string, FeatureDefinition>,
): void {
  // skip: the panel declares no link
  if (link === undefined) return;
  validateNavigateParams(where, link.params);
  const resolved = resolveDashboardScreenTarget(featureName, link.screen, featureMap);
  if (resolved.kind === "unresolved") {
    throw bootRuleError(DASHBOARD_RULES.panelLinkTarget, {
      message: `${where} screen "${link.screen}" does not resolve to a registered screen (checked "${resolved.qn}"). Use a same-feature short id or a cross-feature QN "<feature>:screen:<id>".`,
    });
  }
  if (link.namedFilter === undefined) return;
  if (resolved.kind !== "list") {
    throw bootRuleError(DASHBOARD_RULES.panelLinkTarget, {
      message: `${where} sets namedFilter "${link.namedFilter}" but screen "${resolved.screenId}" is not a list screen. Remove namedFilter.`,
    });
  }
  if (!declaredNamedFilterIds(resolved.target).has(link.namedFilter)) {
    throw bootRuleError(DASHBOARD_RULES.panelLinkTarget, {
      message: `${where} namedFilter "${link.namedFilter}" is not declared in namedFilters of screen "${resolved.target.screen.id}". Add { id, label } to that screen.`,
    });
  }
}
