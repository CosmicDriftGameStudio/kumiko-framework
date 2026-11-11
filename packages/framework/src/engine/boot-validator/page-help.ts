import type { PageHelpSpec } from "@cosmicdrift/kumiko-types/screen";
import { hasLocaleValue, selectFacetOptionKey } from "../../i18n/required-surface-keys.ts";
import type { FeatureDefinition } from "../types/index.ts";
import { collectBootRuleViolations } from "./boot-report.ts";
import { bootRuleError } from "./boot-rule.ts";
import { PAGE_HELP_RULES } from "./page-help-rules.ts";

type PageHelpScreen = {
  readonly id: string;
  readonly type: "entityList" | "projectionDetail";
  readonly entity?: string;
  readonly pageHelp: PageHelpSpec;
};

function pageHelpScreensOf(feature: FeatureDefinition): readonly PageHelpScreen[] {
  const found: PageHelpScreen[] = [];
  for (const screen of Object.values(feature.screens)) {
    if (screen.type !== "entityList" && screen.type !== "projectionDetail") continue;
    if (screen.pageHelp === undefined) continue;
    found.push({
      id: screen.id,
      type: screen.type,
      pageHelp: screen.pageHelp,
      ...(screen.type === "entityList" && { entity: screen.entity }),
    });
  }
  return found;
}

function translationByLocale(feature: FeatureDefinition, fullKey: string) {
  const local = fullKey.slice(feature.name.length + 1);
  return feature.translations?.[local] ?? feature.translations?.[fullKey];
}

function checkPageHelpScreen(feature: FeatureDefinition, screen: PageHelpScreen): void {
  const prefix = `[pageHelp] Feature "${feature.name}" screen "${screen.id}"`;
  const { statusField } = screen.pageHelp;
  const entityName = screen.pageHelp.entity ?? screen.entity;
  const entity = entityName === undefined ? undefined : feature.entities?.[entityName];
  if (entityName === undefined || entity === undefined) {
    throw bootRuleError(PAGE_HELP_RULES.statusFieldInvalid, {
      message: `${prefix}: pageHelp.entity ${entityName === undefined ? "is required on a projectionDetail" : `"${entityName}" is not an entity of this feature`}.`,
    });
  }
  const field = entity.fields[statusField];
  if (field === undefined || field.type !== "select") {
    throw bootRuleError(PAGE_HELP_RULES.statusFieldInvalid, {
      message: `${prefix}: pageHelp.statusField "${statusField}" is not a select field of entity "${entityName}".`,
    });
  }
  const missing: string[] = [];
  for (const value of field.options) {
    const labelKey = selectFacetOptionKey(feature.name, entityName, statusField, value);
    const helpKey = `${labelKey}:help`;
    const labelLocales = Object.keys(translationByLocale(feature, labelKey) ?? {});
    const help = translationByLocale(feature, helpKey);
    const gaps = labelLocales.filter((locale) => !hasLocaleValue(help?.[locale]));
    if (help === undefined && labelLocales.length === 0) missing.push(`${value} -> ${helpKey}`);
    else if (gaps.length > 0) missing.push(`${value} -> ${helpKey} (${gaps.join(", ")})`);
  }
  if (missing.length > 0) {
    throw bootRuleError(PAGE_HELP_RULES.optionHelpMissing, {
      message: `${prefix}: pageHelp field "${statusField}" lacks help text for option(s): ${missing.join("; ")}. Add them via r.translations(...).`,
    });
  }
}

export function validatePageHelp(features: readonly FeatureDefinition[]): void {
  const screens = features.flatMap((feature) =>
    pageHelpScreensOf(feature).map((screen) => ({ feature, screen })),
  );
  collectBootRuleViolations(screens, ({ feature, screen }) => checkPageHelpScreen(feature, screen));
}
