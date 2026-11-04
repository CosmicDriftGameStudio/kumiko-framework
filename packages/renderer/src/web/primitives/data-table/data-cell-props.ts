import type { ListColumnViewModel } from "../../../headless/index.ts";

/** Optional presentation props every DataTableCell gets from its column. */
export function columnCellPresentationProps(col: ListColumnViewModel) {
  return {
    ...(col.optionLabels !== undefined && { optionLabels: col.optionLabels }),
    ...(col.optionTones !== undefined && { optionTones: col.optionTones }),
    ...(col.grouping !== undefined && { grouping: col.grouping }),
    ...(col.hint !== undefined && { hint: col.hint }),
    ...(col.display !== undefined && { display: col.display }),
    ...(col.badgeToneField !== undefined && { badgeToneField: col.badgeToneField }),
  };
}
