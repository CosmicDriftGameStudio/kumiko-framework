import type { MultiSelectFieldDef } from "@cosmicdrift/kumiko-types/fields";
import { SELECT_OPTION_TONES } from "@cosmicdrift/kumiko-types/fields";
import type { QueryHandlerDef } from "@cosmicdrift/kumiko-types/handlers";
import type { FieldCondition } from "@cosmicdrift/kumiko-types/screen";
import type { FeatureDefinition } from "../types/index.ts";
import { bootRuleError } from "./boot-rule.ts";
import { ENTITY_SELECT_IMAGE_RULES } from "./entity-select-image-rules.ts";
import { isSelectOptionTone } from "./select-option-tone.ts";

// --- MultiSelect field validation ---
//
// options must be non-empty (otherwise the field cannot be used), and
// default — when set — must be a subset of options. Both conditions would
// also fail at runtime in the Zod schema; boot validation only provides
// the earliest clear error messages.
// Exhaustive over MultiSelectFieldDef["columns"] (the compiler flags a union
// change); the TS union is gone at runtime for JS/JSON-sourced definitions.
const CHECKBOX_COLUMN_COUNTS = {
  1: true,
  2: true,
  3: true,
  4: true,
} satisfies Record<NonNullable<MultiSelectFieldDef["columns"]>, true>;

function validateCheckboxDisplayOptions(
  field: MultiSelectFieldDef,
  fieldName: string,
  entityName: string,
): void {
  if (field.display === "checkboxes") {
    if (field.columns !== undefined && !(field.columns in CHECKBOX_COLUMN_COUNTS)) {
      throw bootRuleError(ENTITY_SELECT_IMAGE_RULES.multiSelectColumnsInvalid, {
        message: `MultiSelect field "${fieldName}" on entity "${entityName}" has invalid columns "${field.columns}" — must be ${Object.keys(CHECKBOX_COLUMN_COUNTS).join(", ")}.`,
      });
    }
    if (field.maxRows !== undefined && (!Number.isInteger(field.maxRows) || field.maxRows < 1)) {
      throw bootRuleError(ENTITY_SELECT_IMAGE_RULES.multiSelectMaxRowsInvalid, {
        message: `MultiSelect field "${fieldName}" on entity "${entityName}" has invalid maxRows "${field.maxRows}" — must be a positive integer.`,
      });
    }
    // skip: checkboxes is the valid display for these options — the checks below only apply to other displays
    return;
  }
  if (field.columns !== undefined) {
    throw bootRuleError(ENTITY_SELECT_IMAGE_RULES.multiSelectColumnsWithoutCheckboxes, {
      message: `MultiSelect field "${fieldName}" on entity "${entityName}" sets columns, which is only valid with display: "checkboxes".`,
    });
  }
  if (field.maxRows !== undefined) {
    throw bootRuleError(ENTITY_SELECT_IMAGE_RULES.multiSelectMaxRowsWithoutCheckboxes, {
      message: `MultiSelect field "${fieldName}" on entity "${entityName}" sets maxRows, which is only valid with display: "checkboxes".`,
    });
  }
}

function assertSelectOptionTones(
  field: { readonly type: string; readonly optionTones?: Readonly<Record<string, unknown>> },
  path: string,
  featureName: string,
): void {
  const tones = field.type === "select" ? Object.entries(field.optionTones ?? {}) : [];
  for (const [optionValue, tone] of tones) {
    if (!isSelectOptionTone(tone)) {
      throw bootRuleError(ENTITY_SELECT_IMAGE_RULES.selectOptionToneInvalid, {
        message:
          `[Feature ${featureName}] Entity select field "${path}" optionTones["${optionValue}"] is ` +
          `"${String(tone)}" — expected one of ${SELECT_OPTION_TONES.join(", ")}.`,
      });
    }
  }
}

export function validateEntitySelectOptionsQuery(feature: FeatureDefinition): void {
  for (const [entityName, entity] of Object.entries(feature.entities ?? {})) {
    for (const [fieldName, field] of Object.entries(entity.fields)) {
      assertNoSelectOptionsQuery(field, `${entityName}.${fieldName}`, feature.name);
      assertSelectOptionTones(field, `${entityName}.${fieldName}`, feature.name);
      if (field.type !== "embedded") continue;
      for (const [subName, subField] of Object.entries(field.schema ?? {})) {
        assertNoSelectOptionsQuery(subField, `${entityName}.${fieldName}.${subName}`, feature.name);
        assertSelectOptionTones(subField, `${entityName}.${fieldName}.${subName}`, feature.name);
      }
    }
  }
}

function assertNoSelectOptionsQuery(
  field: { readonly type: string },
  path: string,
  featureName: string,
): void {
  // @cast-boundary schema-walk — embedded sub-field types don't declare optionsQuery, an untyped author may still set it
  const { optionsQuery, optionsQueryPayload } = field as {
    optionsQuery?: unknown;
    optionsQueryPayload?: unknown;
  };
  const declaresOptionsQuery = optionsQuery !== undefined || optionsQueryPayload !== undefined;
  if (field.type === "select" && declaresOptionsQuery) {
    throw bootRuleError(ENTITY_SELECT_IMAGE_RULES.selectOptionsQueryUnsupported, {
      message: `[Feature ${featureName}] Entity select field "${path}" declares optionsQuery — not supported on entity fields because the stored value would not be validated against the query result. Use static options, or a reference field.`,
    });
  }
}

// A typo'd availability QN would only surface as a failed query when the form
// mounts, so it is pinned at boot like the other option queries.
export function validateEntitySelectAvailabilityQuery(
  feature: FeatureDefinition,
  queryHandlers: ReadonlyMap<string, QueryHandlerDef>,
): void {
  for (const [entityName, entity] of Object.entries(feature.entities ?? {})) {
    for (const [fieldName, field] of Object.entries(entity.fields)) {
      if (
        (field.type !== "select" && field.type !== "multiSelect") ||
        field.optionsAvailabilityQuery === undefined
      )
        continue;
      const query = field.optionsAvailabilityQuery;
      if (query.length === 0 || !queryHandlers.has(query)) {
        throw bootRuleError(ENTITY_SELECT_IMAGE_RULES.selectAvailabilityQueryUnregistered, {
          message:
            `[Feature ${feature.name}] ${field.type === "select" ? "Select" : "MultiSelect"} field "${fieldName}" on entity "${entityName}" ` +
            `declares optionsAvailabilityQuery "${query}" which is not a registered query-handler. ` +
            `Check the QN spelling (expected "<feature>:query:<short>") and that the handler ` +
            `is declared via r.queryHandler(...).`,
        });
      }
    }
  }
}

export function conditionComparisonValues(
  when: Exclude<FieldCondition, boolean>,
): readonly unknown[] {
  if ("eq" in when) return [when.eq];
  if ("ne" in when) return [when.ne];
  if ("in" in when) return when.in;
  return when.notIn;
}

export function validateEntitySelectConditionalOptions(feature: FeatureDefinition): void {
  for (const [entityName, entity] of Object.entries(feature.entities ?? {})) {
    for (const [fieldName, field] of Object.entries(entity.fields)) {
      if (field.type !== "select" || field.conditionalOptions === undefined) continue;
      const where = `[Feature ${feature.name}] Select field "${fieldName}" on entity "${entityName}"`;
      if (field.optionsQuery !== undefined) {
        throw bootRuleError(ENTITY_SELECT_IMAGE_RULES.conditionalOptionsWithOptionsQuery, {
          message: `${where} combines conditionalOptions with optionsQuery — conditionalOptions filters the static options only. Remove either conditionalOptions or optionsQuery.`,
        });
      }
      const knownOptions = new Set<string>(field.options);
      const ruleOfOption = new Map<string, number>();
      field.conditionalOptions.forEach((rule, ruleIndex) => {
        const ruleLabel = `conditionalOptions[${ruleIndex}]`;
        if (rule.options.length === 0) {
          throw bootRuleError(ENTITY_SELECT_IMAGE_RULES.conditionalOptionsRuleEmpty, {
            message: `${where} has an empty ${ruleLabel}.options — drop the rule.`,
          });
        }
        for (const option of rule.options) {
          if (!knownOptions.has(option)) {
            throw bootRuleError(ENTITY_SELECT_IMAGE_RULES.conditionalOptionUnknown, {
              message: `${where} lists "${option}" in ${ruleLabel} which is not in options (${field.options.join(", ")}).`,
            });
          }
          const otherRule = ruleOfOption.get(option);
          if (otherRule !== undefined) {
            throw bootRuleError(ENTITY_SELECT_IMAGE_RULES.conditionalOptionDuplicate, {
              message: `${where} lists "${option}" in conditionalOptions[${otherRule}] and ${ruleLabel} — an option may belong to one rule only. Remove the option from one of the rules.`,
            });
          }
          ruleOfOption.set(option, ruleIndex);
          if (option === field.default) {
            throw bootRuleError(ENTITY_SELECT_IMAGE_RULES.conditionalOptionDefault, {
              message: `${where} has default "${option}" inside ${ruleLabel} — the default must be available unconditionally.`,
            });
          }
        }
        const conditionField = rule.when.field;
        if (conditionField === fieldName) {
          throw bootRuleError(ENTITY_SELECT_IMAGE_RULES.conditionalWhenOwnField, {
            message: `${where} has ${ruleLabel}.when on its own field. Make the condition depend on a different field.`,
          });
        }
        if (!(conditionField in entity.fields)) {
          throw bootRuleError(ENTITY_SELECT_IMAGE_RULES.conditionalWhenUnknownField, {
            message: `${where} has ${ruleLabel}.when.field "${conditionField}" which is not a field of the entity. Use an existing field of the entity in when.field.`,
          });
        }
        const conditionFieldDef = entity.fields[conditionField];
        if (conditionFieldDef?.type === "select" || conditionFieldDef?.type === "multiSelect") {
          const conditionOptions: readonly string[] = conditionFieldDef.options;
          for (const value of conditionComparisonValues(rule.when)) {
            if (typeof value !== "string" || !conditionOptions.includes(value)) {
              throw bootRuleError(ENTITY_SELECT_IMAGE_RULES.conditionalWhenValueNotOption, {
                message: `${where} has ${ruleLabel}.when value "${String(value)}" which is not an option of "${conditionField}" (${conditionOptions.join(", ")}).`,
              });
            }
          }
        }
      });
    }
  }
}

export function validateMultiSelectFields(feature: FeatureDefinition): void {
  for (const [entityName, entity] of Object.entries(feature.entities ?? {})) {
    for (const [fieldName, field] of Object.entries(entity.fields)) {
      if (field.type !== "multiSelect") continue;

      if (field.options.length === 0) {
        throw bootRuleError(ENTITY_SELECT_IMAGE_RULES.multiSelectOptionsEmpty, {
          message: `MultiSelect field "${fieldName}" on entity "${entityName}" in feature "${feature.name}" has empty options. Add at least one option.`,
        });
      }

      if (field.default !== undefined) {
        const validOptions = new Set<string>(field.options);
        for (const value of field.default) {
          if (!validOptions.has(value)) {
            throw bootRuleError(ENTITY_SELECT_IMAGE_RULES.multiSelectDefaultNotOption, {
              message: `MultiSelect default "${value}" on "${entityName}.${fieldName}" is not a valid option. Valid: ${field.options.join(", ")}`,
            });
          }
        }
      }

      validateCheckboxDisplayOptions(field, fieldName, entityName);
    }
  }
}
