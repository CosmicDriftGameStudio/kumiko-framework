import { isDeepStrictEqual } from "node:util";
import type {
  DashboardStatPanel,
  EntityListScreenDefinition,
} from "@cosmicdrift/kumiko-types/screen";
import { toKebab } from "../qualified-name.ts";
import type { FeatureDefinition } from "../types/index.ts";
import { bootRuleError } from "./boot-rule.ts";
import {
  declaredNamedFilterIds,
  type ListTarget,
  resolveDashboardScreenTarget,
} from "./dashboard-screen-target.ts";
import { NAMED_FILTER_RULES } from "./named-filter-rules.ts";
import { DASHBOARD_RULES } from "./screens-dashboard-rules.ts";

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

// `where` names the option holding the params ("... stat "x" navigate", "... footerLink").
export function validateNavigateParams(
  where: string,
  params: Readonly<Record<string, unknown>> | undefined,
): void {
  for (const [key, value] of Object.entries(params ?? {})) {
    if (key === "" || typeof value !== "string") {
      throw bootRuleError(DASHBOARD_RULES.statNavigateParamsInvalid, {
        message: `${where} params entry ${JSON.stringify(key)} must have a non-empty key and a string value (got ${JSON.stringify(value)}).`,
      });
    }
  }
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
  validateNavigateParams(`${context} navigate`, navigate.params);
  const resolved = resolveDashboardScreenTarget(featureName, navigate.screen, featureMap);
  if (resolved.kind === "unresolved" || resolved.kind === "other") {
    throw bootRuleError(NAMED_FILTER_RULES.statNavigateTarget, {
      message: `${context} navigate.screen "${navigate.screen}" does not resolve to a registered entityList, projectionList or custom screen (checked "${resolved.qn}").`,
    });
  }
  if (resolved.kind === "custom") {
    // A custom screen has no list query to count with, so the tile keeps its own query.
    if (navigate.namedFilter !== undefined) {
      throw bootRuleError(DASHBOARD_RULES.statNavigateCustomWithFilter, {
        message: `${context} navigate.screen "${resolved.screenId}" is a custom screen, which has no namedFilters. Remove navigate.namedFilter.`,
      });
    }
    return;
  }
  const target = resolved.target;
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
