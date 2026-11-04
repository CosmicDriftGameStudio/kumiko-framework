import type {
  EntityListScreenDefinition,
  ProjectionListScreenDefinition,
} from "@cosmicdrift/kumiko-types/screen";
import type { FeatureDefinition } from "../types/index.ts";
import { resolveScreenTargetQn } from "./screens-actions.ts";

export type ListTarget = {
  readonly feature: FeatureDefinition;
  readonly screen: EntityListScreenDefinition | ProjectionListScreenDefinition;
};

export type DashboardScreenTarget =
  | { readonly kind: "list"; readonly target: ListTarget }
  | { readonly kind: "custom"; readonly screenId: string }
  | { readonly kind: "other"; readonly qn: string; readonly screenId: string }
  | { readonly kind: "unresolved"; readonly qn: string };

// One resolver for every dashboard link-like option (stat navigate, list footerLink, stat-group
// link), so they agree on what a screen reference points at.
export function resolveDashboardScreenTarget(
  featureName: string,
  screenRef: string,
  featureMap: ReadonlyMap<string, FeatureDefinition>,
): DashboardScreenTarget {
  const qn = resolveScreenTargetQn(featureName, screenRef);
  const [targetFeatureName = "", , targetShortId = ""] = qn.split(":");
  const feature = featureMap.get(targetFeatureName);
  const screen = feature?.screens[targetShortId];
  if (feature === undefined || screen === undefined) return { kind: "unresolved", qn };
  if (screen.type === "custom") return { kind: "custom", screenId: screen.id };
  if (screen.type !== "entityList" && screen.type !== "projectionList") {
    return { kind: "other", qn, screenId: screen.id };
  }
  return { kind: "list", target: { feature, screen } };
}

export function declaredNamedFilterIds(target: ListTarget): ReadonlySet<string> {
  return new Set((target.screen.namedFilters ?? []).map((ref) => ref.id));
}
