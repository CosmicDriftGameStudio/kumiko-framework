import type { ListColumnPin, ListTableDensity } from "@cosmicdrift/kumiko-types/screen";

export type DataTableDensity = ListTableDensity;
export type DataTableColumnPin = ListColumnPin;
export type DataTableColumnPins = Readonly<Record<string, DataTableColumnPin>>;
export type DataTableColumnWidths = Readonly<Record<string, number>>;

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
  /** Present: pinning is on and the view menu has a pin section. Unpinned columns have no entry. */
  readonly pins?: DataTableColumnPins;
  readonly onPinsChange?: (next: DataTableColumnPins) => void;
  /** Present: resizing is on; the table switches to table-layout fixed. Every column has an entry (px). */
  readonly widths?: DataTableColumnWidths;
  /** Present together with `widths`; every column has an entry (px). */
  readonly minWidths?: DataTableColumnWidths;
  readonly onWidthChange?: (field: string, width: number) => void;
  readonly keyboardNavigation?: boolean;
  /** False once columns, order or density differ from the screen default. */
  readonly viewIsDefault: boolean;
  readonly onViewReset: () => void;
};

export type DataTableResetAll = {
  /** True while something deviates from the screen default. */
  readonly active: boolean;
  readonly onReset: () => void;
};
