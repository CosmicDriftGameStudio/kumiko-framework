import {
  type DerivedCondition,
  type DerivedRelatedMeasure,
  type DerivedValueType,
  type EntityDefinition,
  type FieldDefinition,
  isSqlDerivedField,
  type SqlDerivedFieldDef,
} from "@cosmicdrift/kumiko-types/fields";
import { holdsCiphertextOrSecret } from "../../db/entity-field-encryption.ts";
import { parseRefTargetEntityName } from "../parse-ref-target.ts";
import type { FeatureDefinition } from "../types/index.ts";

export function isSortableSqlDerivedField(entity: EntityDefinition, name: string): boolean {
  const def = entity.derivedFields?.[name];
  return def !== undefined && isSqlDerivedField(def) && def.sortable === true;
}

const VALUE_TYPE_OF_FIELD_TYPE: Readonly<
  Partial<Record<FieldDefinition["type"], DerivedValueType>>
> = {
  text: "text",
  longText: "text",
  select: "text",
  tz: "text",
  reference: "text",
  number: "number",
  bigInt: "number",
  decimal: "decimal",
  boolean: "boolean",
  date: "date",
  timestamp: "timestamp",
};

type Site = { readonly where: string };

function valueTypeOfField(entity: EntityDefinition, field: string): DerivedValueType | undefined {
  if (field === "id") return "text";
  const def = entity.fields[field];
  return def === undefined ? undefined : VALUE_TYPE_OF_FIELD_TYPE[def.type];
}

function requireUsableField(site: Site, entity: EntityDefinition, field: string, role: string) {
  if (field !== "id" && entity.fields[field] === undefined) {
    throw new Error(`${site.where}: ${role} "${field}" is not a field of the entity.`);
  }
  if (valueTypeOfField(entity, field) === undefined) {
    throw new Error(
      `${site.where}: ${role} "${field}" has type "${entity.fields[field]?.type}", which a SQL derived field cannot read (money and compound types are not supported).`,
    );
  }
  if (holdsCiphertextOrSecret(entity, field)) {
    throw new Error(
      `${site.where}: ${role} "${field}" is encrypted or secret; a SQL derived field would expose or order by it.`,
    );
  }
}

function requireValueType(site: Site, def: SqlDerivedFieldDef, expected: DerivedValueType): void {
  if (def.valueType !== expected) {
    throw new Error(`${site.where}: valueType must be "${expected}", got "${def.valueType}".`);
  }
}

function validateCondition(site: Site, related: EntityDefinition, condition: DerivedCondition) {
  if ("activeOn" in condition) {
    for (const field of [condition.activeOn.from, condition.activeOn.to]) {
      requireUsableField(site, related, field, "activeOn field");
      if (valueTypeOfField(related, field) !== "date") {
        throw new Error(`${site.where}: activeOn field "${field}" must be a date field.`);
      }
    }
    // skip: activeOn carries no op/value to check
    return;
  }
  requireUsableField(site, related, condition.field, "where field");
  const { value, op } = condition;
  const isList = Array.isArray(value);
  if ((op === "in") !== isList) {
    throw new Error(
      `${site.where}: where "${condition.field}": op "in" takes a list, and only "in" does.`,
    );
  }
  if (value === null && op !== "eq" && op !== "ne") {
    throw new Error(`${site.where}: where "${condition.field}": null is only valid with eq/ne.`);
  }
  if (typeof value === "object" && value !== null && !isList) {
    const expected = "today" in value ? "date" : "timestamp";
    if (valueTypeOfField(related, condition.field) !== expected) {
      throw new Error(
        `${site.where}: where "${condition.field}": ${expected === "date" ? "today" : "now"} needs a ${expected} field.`,
      );
    }
  }
}

function validateRelated(
  site: Site,
  entityName: string,
  own: EntityDefinition,
  def: SqlDerivedFieldDef,
  spec: Extract<SqlDerivedFieldDef["sql"], { readonly kind: "related" }>,
  allEntities: ReadonlyMap<string, EntityDefinition>,
): void {
  const relatedName = parseRefTargetEntityName(spec.entity);
  const related = allEntities.get(relatedName);
  if (related === undefined) {
    throw new Error(`${site.where}: related entity "${spec.entity}" is not registered.`);
  }
  if (relatedName === entityName || (related.table !== undefined && related.table === own.table)) {
    throw new Error(`${site.where}: an entity cannot derive from itself.`);
  }
  requireUsableField(site, related, spec.on.field, "on.field");
  requireUsableField(site, own, spec.on.outer ?? "id", "on.outer");
  for (const condition of spec.where ?? []) validateCondition(site, related, condition);

  requireMeasureValueType(site, def, spec.measure, related);
}

function requireMeasureValueType(
  site: Site,
  def: SqlDerivedFieldDef,
  measure: DerivedRelatedMeasure,
  related: EntityDefinition,
): void {
  if (measure.kind === "count") {
    requireValueType(site, def, "number");
    // skip: count measures no field
    return;
  }
  requireUsableField(site, related, measure.field, "measure field");
  if (measure.kind === "countDistinct") {
    requireValueType(site, def, "number");
    // skip: countDistinct has no orderBy or label
    return;
  }
  requireUsableField(site, related, measure.orderBy, "measure orderBy");
  if (measure.label === true) {
    const measured = related.fields[measure.field];
    if (measured?.type !== "reference" || measured.labelField === undefined) {
      throw new Error(`${site.where}: label: true needs a reference field with a labelField.`);
    }
    requireValueType(site, def, "text");
    // skip: a label is always text, the measured field's own type does not apply
    return;
  }
  const expected = valueTypeOfField(related, measure.field);
  if (expected !== undefined) requireValueType(site, def, expected);
}

function validateCoalesce(
  site: Site,
  own: EntityDefinition,
  def: SqlDerivedFieldDef,
  fields: readonly string[],
): void {
  if (fields.length === 0) throw new Error(`${site.where}: coalesce needs at least one field.`);
  const types = new Set<DerivedValueType | undefined>();
  for (const field of fields) {
    requireUsableField(site, own, field, "coalesce field");
    types.add(valueTypeOfField(own, field));
  }
  if (types.size !== 1) {
    throw new Error(`${site.where}: coalesce fields must all have the same type.`);
  }
  const [only] = types;
  if (only !== undefined) requireValueType(site, def, only);
}

export function validateSqlDerivedFields(features: readonly FeatureDefinition[]): void {
  const allEntities = new Map<string, EntityDefinition>();
  for (const feature of features) {
    for (const [name, entity] of Object.entries(feature.entities ?? {})) {
      allEntities.set(name, entity);
    }
  }
  for (const [entityName, entity] of allEntities) {
    for (const [key, def] of Object.entries(entity.derivedFields ?? {})) {
      const site: Site = { where: `Entity "${entityName}" derived field "${key}"` };
      if (!isSqlDerivedField(def)) {
        if ("sortable" in def) {
          throw new Error(
            `${site.where}: sortable needs a sql derived field; a JS derive cannot order in SQL.`,
          );
        }
        continue;
      }
      if (def.sql.kind === "coalesce") validateCoalesce(site, entity, def, def.sql.fields);
      else validateRelated(site, entityName, entity, def, def.sql, allEntities);
    }
  }
}
