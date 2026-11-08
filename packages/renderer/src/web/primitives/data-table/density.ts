import type { DataTableDensity, DataTableViewOptions } from "../../../data-table-view-types.ts";

type DensityClasses = {
  /** Table body row. */
  readonly row: string;
  /** Table body cell; `!` beats the fill-height table's own cell padding. */
  readonly cell: string;
  /** Height of a body cell: the board row is 50px; compact rows stay tight. */
  readonly cellHeight: string;
  /** Header cell; keeps the horizontal inset in line with the body cells. */
  readonly header: string;
  /** Card row below the md breakpoint. */
  readonly card: string;
};

const ROW_HEIGHT_CLASS = "h-[50px]";
const NO_DENSITY_CLASSES: DensityClasses = {
  row: "",
  cell: "",
  cellHeight: ROW_HEIGHT_CLASS,
  header: "",
  card: "",
};

// A fill-height table insets its first and last column by 24px; compact keeps that edge.
const FILL_EDGE_INSET = " first:pl-6! last:pr-6!";

const DENSITY_CLASSES: Record<DataTableDensity, DensityClasses> = {
  comfortable: NO_DENSITY_CLASSES,
  relaxed: { row: "", cell: "sm:py-3!", cellHeight: ROW_HEIGHT_CLASS, header: "", card: "" },
  compact: { row: "h-8", cell: "p-1!", cellHeight: "", header: "px-1!", card: "min-h-14 py-2" },
};

/** Comfortable (and a table without `view`) adds only the board row height. */
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
