import type {
  EditExtensionSection,
  EditFieldSpec,
  EditSectionSpec,
  FieldCondition,
  FormatSpec,
  ListColumnSpec,
} from "./types/screen";

export function isExtensionEditSection(section: EditSectionSpec): section is EditExtensionSection {
  return section.kind === "extension";
}

// Type guard — narrows FieldRenderer to FormatSpec. Useful for renderer
// authors who branch on the three FieldRenderer variants without manual
// "format" in renderer checks.
export function isFormatSpec(r: unknown): r is FormatSpec {
  return typeof r === "object" && r !== null && "format" in r && typeof r.format === "string";
}

// Collapse the string-shorthand into the object form. Both the boot-validator
// and (later) ui-core's view-model builder iterate over fields/columns — the
// helper keeps that loop from growing two branches everywhere.
export function normalizeListColumn(c: ListColumnSpec): Exclude<ListColumnSpec, string> {
  const col = typeof c === "string" ? { field: c } : c;
  if (
    typeof process !== "undefined" &&
    process.env.NODE_ENV !== "production" &&
    col.renderer !== undefined &&
    typeof col.renderer === "function"
  ) {
    // biome-ignore lint/suspicious/noConsole: dev-only warning
    console.warn(
      `[kumiko] normalizeListColumn: Feld "${col.field}" hat einen Funktions-Renderer — dieser wird von JSON.stringify verworfen. Bitte auf FormatSpec ({ format: "..." }) migrieren.`,
    );
  }
  return col;
}

/** Evaluates a declarative FieldCondition against the current row/form
 *  values. THE single implementation — renderer (row-action visibility),
 *  headless view-model (visible/readOnly/required) and render-edit
 *  (form-condition closures) reuse it; three hand-rolled copies had
 *  already drifted in shape. */
export function evalFieldCondition(cond: FieldCondition, values: Record<string, unknown>): boolean {
  if (typeof cond === "boolean") return cond;
  const val = values[cond.field];
  if ("eq" in cond) return val === cond.eq;
  return val !== cond.ne;
}

export function normalizeEditField(f: EditFieldSpec): Exclude<EditFieldSpec, string> {
  return typeof f === "string" ? { field: f } : f;
}
