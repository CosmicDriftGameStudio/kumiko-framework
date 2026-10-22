import type { Cell } from "write-excel-file/node";
import { isPlainObject } from "../../utils/is-plain-object.ts";
import type { ExportRow } from "./export-rows.ts";

export type ReferenceCellKind = {
  readonly kind: "reference";
  readonly labelField: string;
  readonly multiple: boolean;
};

function labelOf(ref: unknown, labelField: string): string | undefined {
  if (!isPlainObject(ref)) return undefined;
  const label = ref[labelField];
  return typeof label === "string" ? label : undefined;
}

function refsOf(row: ExportRow, field: string): unknown {
  const refs = row["_refs"];
  return isPlainObject(refs) ? refs[field] : undefined;
}

/** Labels come from the list row's eager-loaded `_refs`; a missing target shows its raw id. */
export function referenceCell(cell: ReferenceCellKind, field: string, row: ExportRow): Cell {
  const ids = cell.multiple && Array.isArray(row[field]) ? row[field] : [row[field]];
  const ref = refsOf(row, field);
  const labels = ids.map((id) => {
    const target = Array.isArray(ref) ? ref.find((r) => isPlainObject(r) && r["id"] === id) : ref;
    return labelOf(target, cell.labelField) ?? String(id);
  });
  return { value: labels.join(", "), type: String };
}
