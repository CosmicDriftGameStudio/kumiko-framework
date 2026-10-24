import type { EntityDefinition } from "@cosmicdrift/kumiko-types/fields";
import type { ListColumnSpec } from "@cosmicdrift/kumiko-types/screen";
import { holdsCiphertextOrSecret } from "../../db/entity-field-encryption.ts";
import { userMayReadFieldInBulk } from "../../engine/field-access.ts";
import { normalizeListColumn } from "../../engine/screen-helpers.ts";
import type { SessionUser } from "../../engine/types/index.ts";

import type { ReferenceCellKind } from "./export-cells-reference.ts";
import { exportRejection } from "./export-errors.ts";

export type SimpleCellKind =
  | "text"
  | "number"
  | "decimal"
  | "bigInt"
  | "money"
  | "date"
  | "timestamp"
  | "locatedTimestamp"
  | "boolean"
  | "auto";

export type ExportCellKind =
  | { readonly kind: SimpleCellKind }
  | ReferenceCellKind
  | {
      readonly kind: "select" | "multiSelect";
      /** `<feature>:entity:<entity>:field:<field>:option:` — the option value is appended. */
      readonly optionLabelKeyPrefix: string;
    };

export type ExportColumn = {
  readonly field: string;
  readonly headerKey: string;
  readonly headerFallback: string;
  readonly cell: ExportCellKind;
};

export type ExportColumnSource = {
  readonly featureName: string;
  readonly columns: readonly ListColumnSpec[];
  // undefined for projectionList: no entity to derive types or secrets from
  readonly entity: EntityDefinition | undefined;
  readonly entityName: string | undefined;
  readonly user: Pick<SessionUser, "roles">;
};

const PROJECTION_PSEUDO_ENTITY = "__projection__";
const FIELD_KIND_BY_TYPE: Readonly<Record<string, SimpleCellKind>> = {
  number: "number",
  decimal: "decimal",
  bigInt: "bigInt",
  money: "money",
  date: "date",
  timestamp: "timestamp",
  locatedTimestamp: "locatedTimestamp",
  boolean: "boolean",
};

function fieldLabelKey(featureName: string, entityName: string, field: string): string {
  return `${featureName}:entity:${entityName}:field:${field}`;
}

function entityCellKind(
  source: ExportColumnSource,
  entity: EntityDefinition,
  field: string,
): ExportCellKind {
  const def = entity.fields[field];
  if (def?.type === "reference") {
    return {
      kind: "reference",
      labelField: def.labelField ?? "id",
      multiple: def.multiple === true,
    };
  }
  const type = def?.type ?? "text";
  if (type === "select" || type === "multiSelect") {
    return {
      kind: type,
      optionLabelKeyPrefix: `${fieldLabelKey(source.featureName, source.entityName ?? "", field)}:option:`,
    };
  }
  return { kind: FIELD_KIND_BY_TYPE[type] ?? "text" };
}

function projectionCellKind(valueType: string | undefined): ExportCellKind {
  if (valueType === "number" || valueType === "decimal" || valueType === "bigInt") {
    return { kind: valueType };
  }
  return { kind: valueType === "money" ? "money" : "auto" };
}

function isExportableOnEntity(
  source: ExportColumnSource,
  entity: EntityDefinition,
  field: string,
  virtual: boolean,
): boolean {
  if (virtual || !userMayReadFieldInBulk(entity, field, source.user)) return false;
  return !holdsCiphertextOrSecret(entity, field);
}

/**
 * Resolves the requested column ids against the screen's declared columns, in client order.
 * Virtual columns and, on an entityList, encrypted/sensitive fields are dropped without error:
 * the zip response bypasses the PII-leak guard, so this is the only place that keeps them out.
 */
export function resolveExportColumns(
  source: ExportColumnSource,
  requested: readonly string[],
): ExportColumn[] {
  const declared = new Map(
    source.columns.map((spec) => normalizeListColumn(spec)).map((c) => [c.field, c]),
  );
  const seen = new Set<string>();
  const resolved: ExportColumn[] = [];
  for (const field of requested) {
    const column = declared.get(field);
    if (column === undefined) {
      throw exportRejection("export_unknown_column", "columns", { column: field });
    }
    if (seen.has(field)) continue;
    seen.add(field);
    const virtual = column.virtual === true;
    const { entity } = source;
    if (entity !== undefined && !isExportableOnEntity(source, entity, field, virtual)) continue;
    if (entity === undefined && virtual) continue;
    const cell =
      entity !== undefined
        ? entityCellKind(source, entity, field)
        : projectionCellKind(column.valueType);
    const headerEntity = source.entityName ?? PROJECTION_PSEUDO_ENTITY;
    resolved.push({
      field,
      headerKey: column.label ?? fieldLabelKey(source.featureName, headerEntity, field),
      headerFallback: column.label ?? field,
      cell,
    });
  }
  if (resolved.length === 0) throw exportRejection("export_no_columns", "columns");
  return resolved;
}
