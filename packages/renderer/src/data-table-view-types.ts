import type { ListTableDensity } from "@cosmicdrift/kumiko-types/screen";

export type DataTableDensity = ListTableDensity;

/** One column in the view menu. The label comes from the DataTable's own
 *  column of the same `field`. */
export type DataTableViewColumn = {
  readonly field: string;
  readonly visible: boolean;
};

export type DataTableViewOptions = {
  /** Present: the view menu has a column section (visibility + order). The
   *  order lists every column; hidden ones stay in the list. */
  readonly columns?: readonly DataTableViewColumn[];
  readonly onColumnsChange?: (next: readonly DataTableViewColumn[]) => void;
  readonly density: DataTableDensity;
  /** Present: the view menu has a density section. */
  readonly onDensityChange?: (next: DataTableDensity) => void;
  /** False once columns, order or density differ from the screen default. */
  readonly viewIsDefault: boolean;
  readonly onViewReset: () => void;
};

export type DataTableResetAll = {
  /** True while something deviates from the screen default. */
  readonly active: boolean;
  readonly onReset: () => void;
};
