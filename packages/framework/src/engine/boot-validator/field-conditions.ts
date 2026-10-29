import type {
  EmbeddedFieldDef,
  EmbeddedFileSubFieldDef,
  EmbeddedSubFieldDef,
  EntityDefinition,
  FieldDefinition,
  FieldStateConditions,
} from "@cosmicdrift/kumiko-types/fields";
import type { FieldCondition } from "@cosmicdrift/kumiko-types/screen";
import { isFileSubField } from "../../files/file-field-slots.ts";
import { parseMaxSize } from "../../files/types.ts";
import type { FeatureDefinition } from "../types/index.ts";
import { conditionComparisonValues, LOCKABLE_FIELD_TYPES } from "./entity-handler.ts";

type Condition = Exclude<FieldCondition, boolean>;
type StateKey = keyof FieldStateConditions;

const STATE_KEYS: readonly StateKey[] = ["visibleWhen", "requiredWhen"];
const SUB_CONDITION_TYPES: ReadonlySet<string> = new Set([
  "text",
  "number",
  "decimal",
  "money",
  "boolean",
  "date",
  "select",
  "reference",
]);
const NUMERIC_SUB_TYPES: ReadonlySet<string> = new Set(["number", "decimal", "money"]);

function assertNoRequiredConflict(
  where: string,
  def: FieldStateConditions,
  required: boolean,
): void {
  if (!required) return;
  if (def.requiredWhen !== undefined) {
    throw new Error(
      `${where} sets required: true together with requiredWhen — drop required (requiredWhen covers the conditional case).`,
    );
  }
  if (def.visibleWhen !== undefined) {
    throw new Error(
      `${where} sets required: true together with visibleWhen — a hidden field cannot be required; use requiredWhen with the same condition.`,
    );
  }
}

function assertComparisonValuesAreOptions(
  where: string,
  key: StateKey,
  condition: Condition,
  options: readonly string[],
): void {
  for (const value of conditionComparisonValues(condition)) {
    if (typeof value !== "string" || !options.includes(value)) {
      throw new Error(
        `${where} has ${key} value "${String(value)}" which is not an option of "${condition.field}" (${options.join(", ")}).`,
      );
    }
  }
}

function assertTopLevelCondition(
  where: string,
  key: StateKey,
  fieldName: string,
  condition: Condition,
  entity: EntityDefinition,
): void {
  const target = entity.fields[condition.field];
  if (condition.field === fieldName) {
    throw new Error(
      `${where} has ${key} on its own field. Make the condition depend on a different field.`,
    );
  }
  if (target === undefined) {
    throw new Error(
      `${where} has ${key}.field "${condition.field}" which is not a field of the entity. Use an existing field of the entity.`,
    );
  }
  if (!LOCKABLE_FIELD_TYPES.has(target.type)) {
    throw new Error(
      `${where} has ${key}.field "${condition.field}" of type "${target.type}", which does not store a plain scalar the condition can compare. Use a text, select, boolean, number or reference field.`,
    );
  }
  if (target.type === "select") {
    assertComparisonValuesAreOptions(where, key, condition, target.options);
  }
}

function assertSubFieldCondition(
  where: string,
  key: StateKey | "when",
  subName: string | undefined,
  condition: Condition,
  embedded: EmbeddedFieldDef,
): void {
  const target = embedded.schema[condition.field];
  if (condition.field === subName) {
    throw new Error(
      `${where} has ${key} on its own sub-field. Make the condition depend on a sibling.`,
    );
  }
  if (target === undefined) {
    throw new Error(
      `${where} has ${key}.field "${condition.field}" which is not a sub-field of the same row. Use a sibling sub-field.`,
    );
  }
  if (!SUB_CONDITION_TYPES.has(target.type)) {
    throw new Error(
      `${where} has ${key}.field "${condition.field}" of type "${target.type}", which cannot be compared. Use a text, number, decimal, money, boolean, date, select or reference sub-field.`,
    );
  }
  if (target.type === "select") {
    const stateKey = key === "when" ? "visibleWhen" : key;
    assertComparisonValuesAreOptions(where, stateKey, condition, target.options);
  }
}

function assertFileSubField(where: string, sub: EmbeddedFileSubFieldDef): void {
  if (sub.searchable === true) {
    throw new Error(`${where} is a ${sub.type} sub-field and cannot be searchable.`);
  }
  if (sub.maxCount !== undefined && !(Number.isInteger(sub.maxCount) && sub.maxCount > 0)) {
    throw new Error(`${where} has invalid maxCount ${sub.maxCount}. Must be a positive integer.`);
  }
  if (sub.maxSize !== undefined) {
    try {
      parseMaxSize(sub.maxSize);
    } catch {
      throw new Error(`${where} has invalid maxSize "${sub.maxSize}". Use e.g. "10mb", "500kb".`);
    }
  }
  if (sub.accept?.some((ext) => ext.length === 0)) {
    throw new Error(`${where} has an empty entry in accept. List file extensions like "pdf".`);
  }
}

function assertSelectSubFieldTones(where: string, sub: EmbeddedSubFieldDef): void {
  if (sub.type !== "select" || sub.optionTones === undefined) return;
  for (const option of Object.keys(sub.optionTones)) {
    if (!sub.options.includes(option)) {
      throw new Error(
        `${where} has optionTones["${option}"] which is not an option (${sub.options.join(", ")}).`,
      );
    }
  }
}

function assertSubFields(where: string, embedded: EmbeddedFieldDef): void {
  for (const [subName, sub] of Object.entries(embedded.schema)) {
    const subWhere = `${where}.${subName}`;
    assertNoRequiredConflict(subWhere, sub, sub.required === true);
    for (const key of STATE_KEYS) {
      const condition = sub[key];
      if (condition !== undefined)
        assertSubFieldCondition(subWhere, key, subName, condition, embedded);
    }
    assertSelectSubFieldTones(subWhere, sub);
    if (isFileSubField(sub)) assertFileSubField(subWhere, sub);
  }
}

function assertNumericSources(
  where: string,
  derivedName: string,
  embedded: EmbeddedFieldDef,
  from: readonly string[],
): void {
  for (const source of from) {
    const sourceType = embedded.schema[source]?.type;
    if (sourceType === undefined || !NUMERIC_SUB_TYPES.has(sourceType)) {
      throw new Error(
        `${where} has a derived cell "${derivedName}" reading "${source}", which is not a number, decimal or money sub-field.`,
      );
    }
  }
}

function assertDerivedCells(where: string, embedded: EmbeddedFieldDef): void {
  for (const [name, cell] of Object.entries(embedded.derived ?? {})) {
    const target = embedded.schema[name];
    assertNumericSources(where, name, embedded, cell.from);
    if (cell.op === "inRange") {
      if (cell.from.length !== 3) {
        throw new Error(
          `${where} has a derived cell "${name}" with op "inRange", which needs exactly three sources (value, min, max).`,
        );
      }
      if (
        target?.type !== "select" ||
        !target.options.includes(cell.inside) ||
        !target.options.includes(cell.outside)
      ) {
        throw new Error(
          `${where} has a derived cell "${name}" with op "inRange", whose target must be a select sub-field with the options "${cell.inside}" and "${cell.outside}".`,
        );
      }
    } else if (target === undefined || !NUMERIC_SUB_TYPES.has(target.type)) {
      throw new Error(
        `${where} has a derived cell "${name}" with op "${cell.op}", whose target must be a number, decimal or money sub-field.`,
      );
    }
    if (cell.when !== undefined) {
      assertSubFieldCondition(`${where}.${name}`, "when", undefined, cell.when, embedded);
      if (cell.when.field in (embedded.derived ?? {})) {
        throw new Error(
          `${where} has a derived cell "${name}" whose when reads the derived cell "${cell.when.field}". Read a stored sub-field.`,
        );
      }
    }
  }
}

function assertFileSubFieldsAreNotWired(where: string, embedded: EmbeddedFieldDef): void {
  const fileSubs = new Set(
    Object.entries(embedded.schema).flatMap(([name, sub]) => (isFileSubField(sub) ? [name] : [])),
  );
  if (fileSubs.size === 0) return;
  const wired = [
    ...Object.entries(embedded.derived ?? {}).flatMap(([name, cell]) => [name, ...cell.from]),
    ...Object.keys(embedded.totalsMatch ?? {}),
    ...(embedded.totals ?? []).flatMap((total) =>
      typeof total === "string" ? [total] : total.from,
    ),
  ];
  const offender = wired.find((name) => fileSubs.has(name));
  if (offender !== undefined) {
    throw new Error(
      `${where} uses file sub-field "${offender}" in derived or totals, which only take number, decimal or money sub-fields.`,
    );
  }
}

function assertEmbeddedField(where: string, embedded: EmbeddedFieldDef): void {
  assertSubFields(where, embedded);
  assertFileSubFieldsAreNotWired(where, embedded);
  assertDerivedCells(where, embedded);
}

function assertField(
  feature: FeatureDefinition,
  entityName: string,
  entity: EntityDefinition,
  fieldName: string,
  field: FieldDefinition,
): void {
  const where = `[Feature ${feature.name}] Field "${fieldName}" on entity "${entityName}"`;
  assertNoRequiredConflict(where, field, "required" in field && field.required === true);
  for (const key of STATE_KEYS) {
    const condition = field[key];
    if (condition !== undefined) assertTopLevelCondition(where, key, fieldName, condition, entity);
  }
  if (field.type === "embedded") assertEmbeddedField(where, field);
}

export function validateFieldConditions(feature: FeatureDefinition): void {
  for (const [entityName, entity] of Object.entries(feature.entities ?? {})) {
    for (const [fieldName, field] of Object.entries(entity.fields)) {
      assertField(feature, entityName, entity, fieldName, field);
    }
  }
}
