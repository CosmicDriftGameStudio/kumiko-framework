import type { PageHelpSpec } from "@cosmicdrift/kumiko-types/screen";
import { hasLocaleValue, selectFacetOptionKey } from "../../i18n/required-surface-keys.ts";
import { parseRefTarget } from "../parse-ref-target.ts";
import type { FeatureDefinition } from "../types/index.ts";
import { collectBootRuleViolations } from "./boot-report.ts";
import { bootRuleError } from "./boot-rule.ts";
import { PAGE_HELP_RULES } from "./page-help-rules.ts";

type PageHelpSite = {
  /** Where the spec sits, for the message: `screen "id"` or `screen "id" relatedList "title"`. */
  readonly where: string;
  /** Entity used when the spec names none: the entityList entity or the relatedList section entity. */
  readonly defaultEntity?: string;
  readonly pageHelp: PageHelpSpec;
};

function pageHelpSitesOf(feature: FeatureDefinition): readonly PageHelpSite[] {
  const found: PageHelpSite[] = [];
  for (const screen of Object.values(feature.screens)) {
    const where = `screen "${screen.id}"`;
    if (
      (screen.type === "entityList" || screen.type === "projectionDetail") &&
      screen.pageHelp !== undefined
    ) {
      found.push({
        where,
        pageHelp: screen.pageHelp,
        ...(screen.type === "entityList" && { defaultEntity: screen.entity }),
      });
    }
    if (screen.type !== "entityEdit" && screen.type !== "projectionDetail") continue;
    for (const section of screen.layout.sections) {
      if (!("kind" in section) || section.kind !== "relatedList") continue;
      if (section.pageHelp === undefined) continue;
      found.push({
        where: `${where} relatedList "${section.title}"`,
        pageHelp: section.pageHelp,
        ...(section.entity !== undefined && { defaultEntity: section.entity }),
      });
    }
  }
  return found;
}

function translationByLocale(owner: FeatureDefinition, fullKey: string) {
  const local = fullKey.slice(owner.name.length + 1);
  return owner.translations?.[local] ?? owner.translations?.[fullKey];
}

function checkPageHelpSite(
  features: readonly FeatureDefinition[],
  feature: FeatureDefinition,
  site: PageHelpSite,
): void {
  const prefix = `[pageHelp] Feature "${feature.name}" ${site.where}`;
  const { statusField } = site.pageHelp;
  const rawEntity = site.pageHelp.entity ?? site.defaultEntity;
  if (rawEntity === undefined) {
    throw bootRuleError(PAGE_HELP_RULES.statusFieldInvalid, {
      message: `${prefix}: pageHelp.entity is required on a projectionDetail.`,
    });
  }
  const target = parseRefTarget(rawEntity, feature.name);
  const owner = features.find((candidate) => candidate.name === target.featureName);
  if (owner === undefined) {
    throw bootRuleError(PAGE_HELP_RULES.statusFieldInvalid, {
      message: `${prefix}: pageHelp.entity "${rawEntity}" names unknown feature "${target.featureName}".`,
    });
  }
  const entityName = target.entityName;
  const entity = owner.entities?.[entityName];
  if (entity === undefined) {
    throw bootRuleError(PAGE_HELP_RULES.statusFieldInvalid, {
      message: `${prefix}: pageHelp.entity "${rawEntity}" is not an entity of feature "${owner.name}".`,
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
    const labelKey = selectFacetOptionKey(owner.name, entityName, statusField, value);
    const helpKey = `${labelKey}:help`;
    const labelLocales = Object.keys(translationByLocale(owner, labelKey) ?? {});
    const help = translationByLocale(owner, helpKey);
    const gaps = labelLocales.filter((locale) => !hasLocaleValue(help?.[locale]));
    if (help === undefined && labelLocales.length === 0) missing.push(`${value} -> ${helpKey}`);
    else if (gaps.length > 0) missing.push(`${value} -> ${helpKey} (${gaps.join(", ")})`);
  }
  if (missing.length > 0) {
    throw bootRuleError(PAGE_HELP_RULES.optionHelpMissing, {
      message: `${prefix}: pageHelp field "${statusField}" lacks help text for option(s): ${missing.join("; ")}. Add them via r.translations(...) in feature "${owner.name}".`,
    });
  }
}

export function validatePageHelp(features: readonly FeatureDefinition[]): void {
  const sites = features.flatMap((feature) =>
    pageHelpSitesOf(feature).map((site) => ({ feature, site })),
  );
  collectBootRuleViolations(sites, ({ feature, site }) =>
    checkPageHelpSite(features, feature, site),
  );
}
