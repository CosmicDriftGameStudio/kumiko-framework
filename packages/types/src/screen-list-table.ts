import type { ListAggregateMeasureKind } from "./list-aggregate-types.ts";

export const LIST_TABLE_DENSITIES = ["comfortable", "compact", "relaxed"] as const;
export type ListTableDensity = (typeof LIST_TABLE_DENSITIES)[number];

/** Upper bound for a list column width in pixels; the renderer clamps to it, the boot validator rejects above it. */
export const LIST_COLUMN_MAX_WIDTH_PX = 2000;

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
  "summaryRow",
  "compactHeader",
  "frame",
] as const;
export const LIST_TABLE_FRAMES = ["card"] as const;
export type ListTableFrame = (typeof LIST_TABLE_FRAMES)[number];
export const LIST_TOOLBAR_ACTIONS_PLACEMENTS = ["header", "toolbar"] as const;
export type ListToolbarActionsPlacement = (typeof LIST_TOOLBAR_ACTIONS_PLACEMENTS)[number];
export const LIST_NARROW_FACETS = ["pills"] as const;
export type ListNarrowFacets = (typeof LIST_NARROW_FACETS)[number];
export const LIST_TABLE_SUMMARY_ROW_KEYS = ["query", "params"] as const;

export type ListPayloadCapabilities = {
  readonly searchable: boolean;
  readonly filters: boolean;
  readonly namedFilters: boolean;
  readonly screenFilter: boolean;
};

// The optional list-query keys a list screen sends for what it declares, in one place so the boot
// validator (summary-row schema check) and the renderer's payload tests agree on them.
export function listPayloadKeysSent(capabilities: ListPayloadCapabilities): readonly string[] {
  return [
    ...(capabilities.searchable ? ["search"] : []),
    ...(capabilities.filters ? ["filters"] : []),
    ...(capabilities.namedFilters ? ["namedFilter"] : []),
    ...(capabilities.screenFilter ? ["filter"] : []),
  ];
}
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
  /** Renders the header row smaller (12px) and semibold. */
  readonly compactHeader?: boolean;
  /** "card": from `sm` up the table, summary row and pager sit in one bordered, rounded card (toolbar and description stay above it); below `sm` the cards of the card layout are bordered, rounded cards with a gap. Default: the table runs frameless over the page width. */
  readonly frame?: ListTableFrame;
  readonly density?: {
    /** Row density on first visit. Default "comfortable"; "relaxed" gives the body cells 12px vertical padding from sm, the header row stays as is. */
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
  /** One line under the rows (above `totals`), computed by a query of your own: "label value · label value"; an item without `label` shows its value alone. */
  readonly summaryRow?: ListTableSummaryRow;
};

/** The query receives the list's current search, filters and named filter (no paging, no sort) plus `params`, and answers `{ items: [{ label?, value, tone?, column? }] }`.
 *  When an item names a `column` (a column field of the list), the table draws the row as a table row: the values stand in the cells under their columns, without labels; items without `column` go to the first column.
 *  Without any `column` the row stays one line "label value · label value". */
export type ListTableSummaryRow = {
  /** Qualified query name, e.g. `feature:query:order:summary`. Its Zod schema accepts every list key the screen sends (search, filters, namedFilter, ...). */
  readonly query: string;
  /** Extra payload keys merged over the list's own. */
  readonly params?: Readonly<Record<string, unknown>>;
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

/** One `table` block for every entityList, projectionList and relatedList of the bundled features. A screen's own `table` keys win per key. `grouping` and `totals` are not accepted here. */
export type BundledListsOptions = {
  readonly table: ListTableOptions;
  /** Pins the first column left on every bundled list where no column is pinned. Needs `table.pinning: true`. */
  readonly pinFirstColumn?: boolean;
};
