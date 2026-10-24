import type { EntityDefinition, FieldDefinition } from "@cosmicdrift/kumiko-types/fields";
import { LIST_AGGREGATE_MEASURE_KINDS } from "@cosmicdrift/kumiko-types/list-aggregate-types";
import { isOneOf, isPlainObject } from "@cosmicdrift/kumiko-types/type-guards";
import {
  isListAggregateGroupable,
  isListAggregateMeasureSupported,
} from "../../db/aggregate-sql.ts";
import { holdsCiphertextOrSecret } from "../../db/entity-field-encryption.ts";
import { normalizeListColumn } from "../screen-helpers.ts";

import {
  LIST_TABLE_GROUPING_KEYS,
  LIST_TABLE_TOTAL_KEYS,
  type ListColumnSpec,
  type ListTableGrouping,
  type ListTableTotal,
} from "../types/screen.ts";
import { rejectUnknownKeys } from "./list-table-reject-unknown-keys.ts";

type FieldType = FieldDefinition["type"];

export type AggregateFieldInfo = {
  readonly type: FieldType;
  readonly multiple: boolean;
  readonly secret: boolean;
};

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isStringRecord(value: unknown): boolean {
  return isPlainObject(value) && Object.values(value).every((entry) => typeof entry === "string");
}

function isGroupKeyScalar(value: unknown): boolean {
  return value === null || ["string", "number", "boolean"].includes(typeof value);
}

function requireScreenColumn(
  where: string,
  path: string,
  field: string,
  columnFields: ReadonlySet<string>,
): void {
  // skip: the field is a column, nothing to report
  if (columnFields.has(field)) return;
  throw new Error(
    `${where} ${path} "${field}" is not a column of this screen. ` +
      `Columns: ${[...columnFields].join(", ")}.`,
  );
}

const GROUPING_VALUE_CHECKS: readonly {
  readonly key: string;
  readonly isValid: (value: unknown) => boolean;
  readonly expected: string;
}[] = [
  { key: "field", isValid: (v) => typeof v === "string", expected: "must be a string" },
  { key: "fields", isValid: isStringArray, expected: "must be an array of field names" },
  { key: "userChoice", isValid: (v) => typeof v === "boolean", expected: "must be a boolean" },
  { key: "label", isValid: (v) => typeof v === "string", expected: "must be an i18n key" },
  { key: "labels", isValid: isStringRecord, expected: "must map group keys to i18n keys" },
  {
    key: "collapsedWhen",
    isValid: isGroupKeyScalar,
    expected: "must be a string, number, boolean or null",
  },
];

function validateGroupingValueTypes(where: string, grouping: Readonly<Record<string, unknown>>) {
  for (const check of GROUPING_VALUE_CHECKS) {
    const value = grouping[check.key];
    if (value !== undefined && !check.isValid(value)) {
      throw new Error(`${where} table.grouping.${check.key} ${check.expected}.`);
    }
  }
}

function validateGroupingFieldChoice(where: string, grouping: Readonly<Record<string, unknown>>) {
  const { field, fields, userChoice } = grouping;
  const offered = isStringArray(fields) ? fields : [];
  if (field === undefined && (userChoice !== true || offered.length === 0)) {
    throw new Error(
      `${where} table.grouping has no field. Set field, or userChoice: true with at least one entry in fields.`,
    );
  }
  if (fields !== undefined && userChoice !== true) {
    throw new Error(
      `${where} table.grouping.fields needs userChoice: true, or the user could never pick them.`,
    );
  }
}

function validateGroupingShape(
  where: string,
  grouping: unknown,
  columnFields: ReadonlySet<string>,
): void {
  if (!isPlainObject(grouping)) {
    throw new Error(`${where} table.grouping must be an object like { field: "status" }.`);
  }
  rejectUnknownKeys(where, "table.grouping", grouping, LIST_TABLE_GROUPING_KEYS);
  validateGroupingValueTypes(where, grouping);
  validateGroupingFieldChoice(where, grouping);
  for (const name of groupingFieldsOf(grouping)) {
    requireScreenColumn(where, "table.grouping field", name, columnFields);
  }
}

function validateTotalsShape(
  where: string,
  totals: unknown,
  columnFields: ReadonlySet<string>,
): void {
  if (!Array.isArray(totals) || totals.length === 0) {
    throw new Error(
      `${where} table.totals must be a non-empty array like [{ field: "amount", kind: "sum" }].`,
    );
  }
  for (const [i, entry] of totals.entries()) {
    if (!isPlainObject(entry)) throw new Error(`${where} table.totals[${i}] must be an object.`);
    rejectUnknownKeys(where, `table.totals[${i}]`, entry, LIST_TABLE_TOTAL_KEYS);
    if (typeof entry["field"] !== "string") {
      throw new Error(`${where} table.totals[${i}].field must be a field name.`);
    }
    if (!isOneOf(LIST_AGGREGATE_MEASURE_KINDS, entry["kind"])) {
      throw new Error(
        `${where} table.totals[${i}].kind must be one of ${LIST_AGGREGATE_MEASURE_KINDS.join(", ")}.`,
      );
    }
    requireScreenColumn(where, `table.totals[${i}].field`, entry["field"], columnFields);
  }
}

export function groupingFieldsOf(grouping: {
  readonly field?: unknown;
  readonly fields?: unknown;
}): string[] {
  const named = typeof grouping.field === "string" ? [grouping.field] : [];
  const offered = isStringArray(grouping.fields) ? grouping.fields : [];
  return [...new Set([...named, ...offered])];
}

/** Structure and column membership; field types are checked where the entity is known. */
export function validateListTableAggregateShape(
  where: string,
  table: Readonly<Record<string, unknown>>,
  columns: readonly ListColumnSpec[],
): void {
  const columnFields = new Set(columns.map((col) => normalizeListColumn(col).field));
  if (table["grouping"] !== undefined)
    validateGroupingShape(where, table["grouping"], columnFields);
  if (table["totals"] !== undefined) validateTotalsShape(where, table["totals"], columnFields);
}

function rejectSecret(where: string, path: string, field: string, info: AggregateFieldInfo): void {
  // skip: only secret fields are rejected here
  if (!info.secret) return;
  throw new Error(
    `${where} ${path} "${field}" is encrypted, personal or secret and cannot be grouped or summed.`,
  );
}

/**
 * `lookup` answers undefined for a field it does not know. With `strict` (an entity
 * stands behind the list) that is an error; otherwise the field is left to the server.
 */
export function validateListTableAggregateFieldTypes(
  where: string,
  table: { readonly grouping?: ListTableGrouping; readonly totals?: readonly ListTableTotal[] },
  lookup: (field: string) => AggregateFieldInfo | undefined,
  strict: boolean,
): void {
  const resolve = (path: string, field: string): AggregateFieldInfo | undefined => {
    const info = lookup(field);
    if (info === undefined && strict) {
      throw new Error(`${where} ${path} "${field}" is not a field of the entity behind this list.`);
    }
    return info;
  };
  for (const field of groupingFieldsOf(table.grouping ?? {})) {
    const info = resolve("table.grouping field", field);
    if (info === undefined) continue;
    rejectSecret(where, "table.grouping field", field, info);
    if (!isListAggregateGroupable(info.type, info.multiple)) {
      throw new Error(
        `${where} table.grouping field "${field}" (${info.type}) cannot be grouped by.`,
      );
    }
  }
  for (const [i, total] of (table.totals ?? []).entries()) {
    const path = `table.totals[${i}]`;
    const info = resolve(`${path}.field`, total.field);
    if (info === undefined) continue;
    rejectSecret(where, `${path}.field`, total.field, info);
    if (!isListAggregateMeasureSupported(total.kind, info.type)) {
      throw new Error(
        `${where} ${path}: "${total.kind}" is not supported on ${info.type} field "${total.field}". ` +
          `sum and avg need number, decimal, money or bigInt; min and max also take date and timestamp.`,
      );
    }
  }
}

export function entityAggregateFieldLookup(
  entity: EntityDefinition,
): (field: string) => AggregateFieldInfo | undefined {
  return (field) => {
    const def = Object.hasOwn(entity.fields, field) ? entity.fields[field] : undefined;
    if (def === undefined) return undefined;
    return {
      type: def.type,
      multiple: def.type === "reference" && def.multiple === true,
      secret: holdsCiphertextOrSecret(entity, field),
    };
  };
}
