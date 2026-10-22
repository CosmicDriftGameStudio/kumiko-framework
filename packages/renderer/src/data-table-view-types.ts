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

/** What the export button sends to POST /api/export/xlsx (xlsx is the only format). */
export type DataTableExport = {
  /** Screen QN `<feature>:screen:<id>`. */
  readonly screen: string;
  readonly screenShortId: string;
  /** The list payload without paging keys; the server reads the whole filtered list. */
  readonly payload: Readonly<Record<string, unknown>>;
  /** Visible column ids in display order. */
  readonly columns: readonly string[];
};

/** The DataTable props a screen's `table` block feeds. */
export type DataTableTableBlock = {
  /** View menu (column picker, density); absent = no menu. */
  readonly view?: DataTableViewOptions;
  /** Replaces the facet reset with one that also covers sort, search and page size. */
  readonly resetAll?: DataTableResetAll;
  /** Present: the toolbar has an export button (web only). */
  readonly exportList?: DataTableExport;
};
