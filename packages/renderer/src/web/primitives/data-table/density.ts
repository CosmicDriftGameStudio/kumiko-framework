import type { DataTableDensity, DataTableViewOptions } from "../../../data-table-view-types.ts";

type DensityClasses = {
  /** Table body row. */
  readonly row: string;
  /** Table body cell; `!` beats the fill-height table's own cell padding. */
  readonly cell: string;
  /** Header cell; keeps the horizontal inset in line with the body cells. */
  readonly header: string;
  /** Card row below the md breakpoint. */
  readonly card: string;
};

const NO_DENSITY_CLASSES: DensityClasses = { row: "", cell: "", header: "", card: "" };

// A fill-height table insets its first and last column by 24px; compact keeps that edge.
const FILL_EDGE_INSET = " first:pl-6! last:pr-6!";

const DENSITY_CLASSES: Record<DataTableDensity, DensityClasses> = {
  comfortable: NO_DENSITY_CLASSES,
  compact: { row: "h-8", cell: "p-1!", header: "px-1!", card: "min-h-14 py-2" },
};

/** Comfortable (and a table without `view`) adds no class at all, so the markup stays as it was. */
export function densityClasses(
  view: DataTableViewOptions | undefined,
  keepsFillEdgeInset: boolean,
): DensityClasses {
  if (view === undefined) return NO_DENSITY_CLASSES;
  const classes = DENSITY_CLASSES[view.density];
  if (!keepsFillEdgeInset || classes.cell === "") return classes;
  return {
    ...classes,
    cell: classes.cell + FILL_EDGE_INSET,
    header: classes.header + FILL_EDGE_INSET,
  };
}
