import type { PageHelpSpec, PageHelpStatusSection } from "@cosmicdrift/kumiko-types/screen";
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
  readonly section: PageHelpStatusSection;
};

function statusSitesOf(
  where: string,
  pageHelp: PageHelpSpec | undefined,
  defaultEntity: string | undefined,
): readonly PageHelpSite[] {
  const found: PageHelpSite[] = [];
  for (const section of pageHelp?.sections ?? []) {
    if (section.kind !== "status") continue;
    found.push({ where, section, ...(defaultEntity !== undefined && { defaultEntity }) });
  }
  return found;
}

function pageHelpSitesOf(feature: FeatureDefinition): readonly PageHelpSite[] {
  const found: PageHelpSite[] = [];
  for (const screen of Object.values(feature.screens)) {
    const where = `screen "${screen.id}"`;
    if (screen.type === "entityList" || screen.type === "projectionDetail") {
      found.push(
        ...statusSitesOf(
          where,
          screen.pageHelp,
          screen.type === "entityList" ? screen.entity : undefined,
        ),
      );
    }
    if (screen.type !== "projectionDetail") continue;
    for (const section of screen.layout.sections) {
      if (!("kind" in section) || section.kind !== "relatedList") continue;
      found.push(
        ...statusSitesOf(
          `${where} relatedList "${section.title}"`,
          section.pageHelp,
          section.entity,
        ),
      );
    }
  }
  return found;
}

/** Places a relatedList carries a pageHelp that no screen renders: only a projectionDetail shows it. */
function unsupportedSitesOf(feature: FeatureDefinition): readonly string[] {
  const found: string[] = [];
  for (const screen of Object.values(feature.screens)) {
    if (screen.type !== "entityEdit") continue;
    for (const section of screen.layout.sections) {
      if (!("kind" in section) || section.kind !== "relatedList") continue;
      if (section.pageHelp !== undefined) {
        found.push(`screen "${screen.id}" relatedList "${section.title}"`);
      }
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
  const statusField = site.section.field;
  const rawEntity = site.section.entity ?? site.defaultEntity;
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
      message: `${prefix}: pageHelp status field "${statusField}" is not a select field of entity "${entityName}".`,
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
  const checks = features.flatMap((feature) => [
    ...unsupportedSitesOf(feature).map((where) => () => {
      throw bootRuleError(PAGE_HELP_RULES.unsupportedSite, {
        message: `[pageHelp] Feature "${feature.name}" ${where}: pageHelp on a relatedList of an entityEdit is never shown.`,
      });
    }),
    ...pageHelpSitesOf(feature).map((site) => () => checkPageHelpSite(features, feature, site)),
  ]);
  collectBootRuleViolations(checks, (check) => check());
}
