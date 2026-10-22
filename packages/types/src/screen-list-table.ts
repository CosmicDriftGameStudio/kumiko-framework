import type { ListAggregateMeasureKind } from "./list-aggregate-types.ts";

export const LIST_TABLE_DENSITIES = ["comfortable", "compact"] as const;
export type ListTableDensity = (typeof LIST_TABLE_DENSITIES)[number];

export const LIST_COLUMN_PINS = ["left", "right"] as const;
export type ListColumnPin = (typeof LIST_COLUMN_PINS)[number];

export const LIST_TABLE_OPTION_KEYS = [
  "rememberState",
  "resetAll",
  "columnPicker",
  "density",
  "pinning",
  "resizing",
  "keyboardNavigation",
  "export",
  "grouping",
  "totals",
] as const;
export const LIST_TABLE_GROUPING_KEYS = [
  "field",
  "label",
  "labels",
  "collapsedWhen",
  "userChoice",
  "fields",
] as const;
export const LIST_TABLE_TOTAL_KEYS = ["field", "kind"] as const;
export const LIST_TABLE_EXPORT_KEYS = ["xlsx", "maxRows"] as const;
export const DEFAULT_EXPORT_MAX_ROWS = 10000;
/** Hard cap: the server builds the whole workbook in memory. */
export const MAX_EXPORT_MAX_ROWS = 100000;
export const LIST_TABLE_DENSITY_KEYS = ["default", "userChoice"] as const;

/** Opt-in table behaviour of a list. Without the block a list renders and behaves exactly as before. */
export type ListTableOptions = {
  /** Keeps search, sort, page size, facets and date range for the browser session and restores them when the screen is opened without list parameters in the URL. A link with parameters always wins. */
  readonly rememberState?: boolean;
  /** Replaces the facet reset with one button that resets search, sort, page size, facets and date range, and drops the remembered list parameters (column and density choices stay). */
  readonly resetAll?: boolean;
  /** Lets the user hide and reorder columns in the view menu. Columns marked `hidden` start hidden. */
  readonly columnPicker?: boolean;
  /** Lets the user pin columns left or right in the view menu; columns may start pinned via `pinned`. Pinned columns stay sticky while scrolling horizontally. No effect in the card layout below `md`. */
  readonly pinning?: boolean;
  /** Switches the table to table-layout fixed; the user drags or uses the arrow keys on the header edge to resize. `width` and `minWidth` on a column are start values; widths are remembered per session. No effect in the card layout. */
  readonly resizing?: boolean;
  /** Rows become one tab stop; ArrowUp/ArrowDown move, Home/End jump, Enter runs the row click. Space stays reserved for selection. */
  readonly keyboardNavigation?: boolean;
  readonly density?: {
    /** Row density on first visit. Default "comfortable". */
    readonly default?: ListTableDensity;
    /** Shows the density choice in the view menu and remembers it per session. */
    readonly userChoice?: boolean;
  };
  /** Shows an export button; the server reads the whole filtered list (not just the visible page). */
  readonly export?: ListTableExportOptions;
  /** Server-side grouping: group headers with count and the `totals` measures over all matching rows; each open group loads its own rows. */
  readonly grouping?: ListTableGrouping;
  /** Footer row under the rows, computed by the server over all rows matching the current filters and search. In grouped mode the same measures show in each group header. */
  readonly totals?: readonly ListTableTotal[];
};

export type ListTableGrouping = {
  /** Start grouping. Without it the list starts ungrouped and the user picks from `fields`. */
  readonly field?: string;
  /** Groups whose key equals this start collapsed and load no rows until opened. */
  readonly collapsedWhen?: string | number | boolean | null;
  /** i18n key of the group header. Placeholders: `{count}` rows in the group, `{value}` the group's value. Default: the value itself. */
  readonly label?: string;
  /** Header i18n key per group key (as string), overriding `label`. */
  readonly labels?: Readonly<Record<string, string>>;
  /** Shows "Group by" in the view menu (needs `fields` or `field`) and remembers the choice per session. */
  readonly userChoice?: boolean;
  /** Fields offered under "Group by"; `field` is always offered. */
  readonly fields?: readonly string[];
};

export type ListTableTotal = {
  readonly field: string;
  /** sum and avg on number, decimal, money and bigInt; min and max also on date and timestamp. Money is shown per currency, never added across currencies. */
  readonly kind: ListAggregateMeasureKind;
};

export type ListTableExportOptions = {
  readonly xlsx: true;
  /** Export is refused above this many rows. Default 10000, hard cap 100000. Encrypted, sensitive and virtual columns are never written. */
  readonly maxRows?: number;
};
