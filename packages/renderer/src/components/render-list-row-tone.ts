import type { DataTableProps } from "../primitives.tsx";
import { isSelectOptionTone } from "../status-tone.ts";

/** Tints a row by the tone its `field` holds; other values leave the row untoned. */
export function rowToneFromField(field: string | undefined): DataTableProps["rowTone"] {
  if (field === undefined) return undefined;
  return (row) => {
    const tone = row.values[field];
    return isSelectOptionTone(tone) ? tone : undefined;
  };
}
