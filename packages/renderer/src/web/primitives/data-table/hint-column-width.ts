import type { CSSProperties } from "react";
import type { ListColumnViewModel } from "../../../headless/index.ts";

// A hint column states its width itself; the resizing layout already owns widths through <col>.
export function hintColumnWidthStyle(
  col: ListColumnViewModel,
  resizing: boolean,
): CSSProperties | undefined {
  if (resizing || col.hint === undefined) return undefined;
  if (col.width === undefined && col.minWidth === undefined) return undefined;
  return {
    ...(col.width !== undefined && { width: col.width }),
    ...(col.minWidth !== undefined && { minWidth: col.minWidth }),
  };
}
