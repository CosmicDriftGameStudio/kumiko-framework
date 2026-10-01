import type { EditFieldViewModel, FieldIssue } from "@cosmicdrift/kumiko-headless";
import type { ReactNode } from "react";
import type { FieldCellWidth, usePrimitives } from "../primitives.js";
import { RenderField } from "./render-field.js";

// Extracted out of render-edit.tsx so write-form-section.tsx can reuse it
// without a circular import between the two components.
export type GridCellForFieldProps = {
  readonly field: EditFieldViewModel;
  readonly columns: number;
  readonly issues: readonly FieldIssue[] | undefined;
  readonly onChange: (value: unknown) => void;
  readonly GridCell: ReturnType<typeof usePrimitives>["GridCell"];
  /** Tier 2.7e-3: passed through so Reference fields can build the correct
   *  lookup query QN (`<feature>:query:<refEntity>:list`). */
  readonly featureName: string;
  readonly labelAppendix?: ReactNode;
  readonly fieldAppendix?: ReactNode;
  /** Full issues-by-path map (FormSnapshot.errors) — passed through for
   *  embedded-list fields, which bucket row-/cell-level issues themselves. */
  readonly allIssues: Readonly<Record<string, readonly FieldIssue[]>>;
  /** Passed through to RenderField unchanged — see RenderEditProps.valueDisplay. */
  readonly valueDisplay: "form" | "text";
  /** Passed through to RenderField as `row` — see RenderFieldProps.row. */
  readonly row: Readonly<Record<string, unknown>>;
  readonly changed?: boolean;
  readonly flow?: boolean;
};

const FIELD_CELL_WIDTH_BY_TYPE: Readonly<Record<string, FieldCellWidth>> = {
  number: "number",
  decimal: "number",
  bigInt: "number",
  money: "money",
  date: "date",
  timestamp: "timestamp",
  locatedTimestamp: "timestamp",
  select: "select",
  multiSelect: "select",
  boolean: "toggle",
  longText: "full",
  embedded: "full",
  jsonb: "full",
  file: "full",
  files: "full",
  image: "full",
  images: "full",
};

const READONLY_FULL_WIDTH_TYPES: ReadonlySet<string> = new Set(["text", "uuid"]);

// Exported for unit tests.
export function fieldCellWidth(field: EditFieldViewModel): FieldCellWidth {
  if (field.span !== undefined || (field.type === "text" && field.multiline)) return "full";
  // A readonly value (UUID, long code) is plain text that must not be cut at the input width.
  if (field.readOnly && READONLY_FULL_WIDTH_TYPES.has(field.type)) return "full";
  return FIELD_CELL_WIDTH_BY_TYPE[field.type] ?? "text";
}

export function GridCellForField({
  field,
  columns,
  issues,
  onChange,
  GridCell,
  featureName,
  labelAppendix,
  fieldAppendix,
  allIssues,
  valueDisplay,
  row,
  changed,
  flow,
}: GridCellForFieldProps): ReactNode {
  // RenderField renders nothing for a hidden field, but the GridCell around it still claims the row.
  if (!field.visible) return null;

  const effectiveSpan = field.span !== undefined ? Math.min(field.span, columns) : 1;
  return (
    <GridCell span={effectiveSpan} {...(flow === true && { width: fieldCellWidth(field) })}>
      <RenderField
        field={field}
        {...(issues !== undefined && { issues })}
        onChange={onChange}
        featureName={featureName}
        {...(labelAppendix !== undefined && { labelAppendix })}
        {...(fieldAppendix !== undefined && { fieldAppendix })}
        allIssues={allIssues}
        valueDisplay={valueDisplay}
        row={row}
        {...(changed === true && { changed })}
      />
    </GridCell>
  );
}
