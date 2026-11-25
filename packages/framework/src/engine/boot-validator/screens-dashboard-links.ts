import type { FeatureDefinition } from "../types/index.ts";
import { bootRuleError } from "./boot-rule.ts";
import { declaredNamedFilterIds, resolveDashboardScreenTarget } from "./dashboard-screen-target.ts";
import { validateNavigateParams } from "./dashboard-stat-navigate.ts";
import { resolveScreenTargetQn } from "./screens-actions.ts";
import { DASHBOARD_RULES } from "./screens-dashboard-rules.ts";

export type DashboardPanelLinkTarget = {
  readonly screen: string;
  readonly namedFilter?: string;
  readonly params?: Readonly<Record<string, unknown>>;
};

// A rowLink naming its target per row (screenField) has nothing to resolve at boot.
export function validateListRowLinkTarget(
  where: string,
  rowLink:
    | {
        readonly screen?: string | undefined;
        readonly presentation?: "page" | "popup" | undefined;
      }
    | undefined,
  featureName: string,
  featureMap: ReadonlyMap<string, FeatureDefinition>,
): void {
  if (rowLink?.screen === undefined) return;
  validateDashboardPanelLink(where, { screen: rowLink.screen }, featureName, featureMap);
  if (rowLink.presentation === "popup") {
    validatePopupRowLinkTarget(where, rowLink.screen, featureName, featureMap);
  }
}

// The popup mounts the detail with the dashboard's own feature schema (like kind:"drawer" actions).
function validatePopupRowLinkTarget(
  where: string,
  screenRef: string,
  featureName: string,
  featureMap: ReadonlyMap<string, FeatureDefinition>,
): void {
  const qn = resolveScreenTargetQn(featureName, screenRef);
  const [targetFeatureName = "", , targetShortId = ""] = qn.split(":");
  const target = featureMap.get(targetFeatureName)?.screens[targetShortId];
  // skip: an unresolved target is reported by validateDashboardPanelLink
  if (target === undefined) return;
  if (targetFeatureName !== featureName) {
    throw bootRuleError(DASHBOARD_RULES.listRowLinkInvalid, {
      message: `${where} presentation "popup" targets screen "${screenRef}" of feature "${targetFeatureName}", but the popup only resolves screens of this feature (like kind:"drawer" actions). Use a same-feature screen or presentation "page".`,
    });
  }
  if (target.type !== "projectionDetail") {
    throw bootRuleError(DASHBOARD_RULES.listRowLinkInvalid, {
      message: `${where} presentation "popup" targets "${screenRef}", a "${target.type}" screen. The popup opens a projectionDetail; point screen at one or use presentation "page".`,
    });
  }
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
