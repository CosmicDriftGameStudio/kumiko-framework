import type { EditFieldViewModel, FieldIssue } from "@cosmicdrift/kumiko-headless";
import type { ReactNode } from "react";
import type { usePrimitives } from "../primitives";
import { RenderField } from "./render-field";

// Winziger Wrapper der die span-Logik kapselt und die Field-Cell in
// die Grid platziert. Eigene Component damit die map-Callback der Caller
// schlank bleibt. Extracted out of render-edit.tsx so write-form-section.tsx
// can reuse it without a circular import between the two components.
export type GridCellForFieldProps = {
  readonly field: EditFieldViewModel;
  readonly columns: number;
  readonly issues: readonly FieldIssue[] | undefined;
  readonly onChange: (value: unknown) => void;
  readonly GridCell: ReturnType<typeof usePrimitives>["GridCell"];
  /** Tier 2.7e-3: durchgereicht damit Reference-Felder die richtige
   *  Lookup-Query-QN bauen können (`<feature>:query:<refEntity>:list`). */
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
};

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
}: GridCellForFieldProps): ReactNode {
  // RenderField renders nothing for a hidden field, but the GridCell around it still claims the row.
  if (!field.visible) return null;

  const effectiveSpan = field.span !== undefined ? Math.min(field.span, columns) : 1;
  return (
    <GridCell span={effectiveSpan}>
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
      />
    </GridCell>
  );
}
