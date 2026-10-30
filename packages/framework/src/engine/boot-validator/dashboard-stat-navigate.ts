import { isDeepStrictEqual } from "node:util";
import type {
  DashboardStatPanel,
  EntityListScreenDefinition,
  ProjectionListScreenDefinition,
} from "@cosmicdrift/kumiko-types/screen";
import { toKebab } from "../qualified-name.ts";
import type { FeatureDefinition } from "../types/index.ts";
import { bootRuleError } from "./boot-rule.ts";
import { NAMED_FILTER_RULES } from "./named-filter-rules.ts";
import { resolveScreenTargetQn } from "./screens-actions.ts";

type ListTarget = {
  readonly feature: FeatureDefinition;
  readonly screen: EntityListScreenDefinition | ProjectionListScreenDefinition;
};

function entityListQueryName(
  feature: FeatureDefinition,
  screen: EntityListScreenDefinition,
): string {
  return `${toKebab(feature.name)}:query:${toKebab(screen.entity)}:list`;
}

function listQueryOf(target: ListTarget): string {
  return target.screen.type === "entityList"
    ? entityListQueryName(target.feature, target.screen)
    : target.screen.query;
}

function declaredNamedFilterIds(target: ListTarget): ReadonlySet<string> {
  return new Set((target.screen.namedFilters ?? []).map((ref) => ref.id));
}

function resolveListTarget(
  featureName: string,
  screenRef: string,
  featureMap: ReadonlyMap<string, FeatureDefinition>,
): ListTarget | { readonly qn: string } {
  const qn = resolveScreenTargetQn(featureName, screenRef);
  const [targetFeatureName = "", , targetShortId = ""] = qn.split(":");
  const feature = featureMap.get(targetFeatureName);
  const screen = feature?.screens[targetShortId];
  if (feature === undefined || screen === undefined) return { qn };
  if (screen.type !== "entityList" && screen.type !== "projectionList") return { qn };
  return { feature, screen };
}

function validateStatNavigate(
  context: string,
  featureName: string,
  stat: DashboardStatPanel,
  featureMap: ReadonlyMap<string, FeatureDefinition>,
): void {
  const navigate = stat.navigate;
  // skip: stat has no navigate target to validate
  if (navigate === undefined) return;
  const target = resolveListTarget(featureName, navigate.screen, featureMap);
  if ("qn" in target) {
    throw bootRuleError(NAMED_FILTER_RULES.statNavigateTarget, {
      message: `${context} navigate.screen "${navigate.screen}" does not resolve to a registered entityList or projectionList screen (checked "${target.qn}").`,
    });
  }
  if (
    navigate.namedFilter !== undefined &&
    !declaredNamedFilterIds(target).has(navigate.namedFilter)
  ) {
    throw bootRuleError(NAMED_FILTER_RULES.statNavigateFilterDeclared, {
      message: `${context} navigate.namedFilter "${navigate.namedFilter}" is not declared in namedFilters of screen "${target.screen.id}". Add { id, label } to that screen.`,
    });
  }
  const listQuery = listQueryOf(target);
  if (stat.query !== listQuery) {
    throw bootRuleError(NAMED_FILTER_RULES.statNavigateSameQuery, {
      message: `${context} navigate targets screen "${target.screen.id}" whose list query is "${listQuery}", but the stat counts with query "${stat.query}". Count with the list's own query so tile and list cannot drift.`,
    });
  }
  if (stat.params?.["namedFilter"] !== navigate.namedFilter) {
    throw bootRuleError(NAMED_FILTER_RULES.statNavigateSameNamedFilter, {
      message: `${context} params.namedFilter (${JSON.stringify(stat.params?.["namedFilter"])}) must equal navigate.namedFilter (${JSON.stringify(navigate.namedFilter)}), otherwise the tile counts other rows than the list shows.`,
    });
  }
  const staticFilter = target.screen.filter;
  if (staticFilter !== undefined && !isDeepStrictEqual(stat.params?.["filter"], staticFilter)) {
    throw bootRuleError(NAMED_FILTER_RULES.statNavigateStaticFilter, {
      message: `${context} target screen "${target.screen.id}" has a static filter the tile does not apply. Set params.filter to the same filter on the stat.`,
    });
  }
}

export function validateDashboardStatNavigate(features: readonly FeatureDefinition[]): void {
  const featureMap = new Map(features.map((f) => [f.name, f] as const));
  for (const feature of features) {
    for (const screen of Object.values(feature.screens)) {
      if (screen.type !== "dashboard") continue;
      for (const panel of screen.panels) {
        const stats =
          panel.kind === "stat" ? [panel] : panel.kind === "stat-group" ? panel.stats : [];
        for (const stat of stats) {
          validateStatNavigate(
            `[Feature ${feature.name}] Screen "${screen.id}" (dashboard) stat "${stat.id}"`,
            feature.name,
            stat,
            featureMap,
          );
        }
      }
    }
  }
}
