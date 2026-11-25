import type { ReactNode } from "react";
import type { DataTableCellEditor } from "../../../data-table-view-types.ts";

/** Native select of an editable cell. Click and key events stop here so they never open the row. */
export function CellEditorSelect({ editor }: { readonly editor: DataTableCellEditor }): ReactNode {
  const empty = editor.value === null || editor.value === "";
  const invalid = empty && editor.required;
  return (
    <select
      aria-label={editor.ariaLabel}
      aria-invalid={invalid ? true : undefined}
      required={editor.required}
      value={editor.value ?? ""}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      onChange={(e) => editor.onChange(e.target.value)}
      className={
        invalid
          ? "h-8 max-w-full rounded-md border border-destructive bg-background px-2 text-sm text-destructive"
          : "h-8 max-w-full rounded-md border border-input bg-background px-2 text-sm text-foreground"
      }
    >
      {empty && (
        <option value="" disabled={editor.required}>
          {editor.placeholder}
        </option>
      )}
      {editor.options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
