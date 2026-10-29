import type { SelectOptionTone } from "@cosmicdrift/kumiko-framework/ui-types";
import type { FieldIssue } from "./headless/index.ts";

// ---- EmbeddedListInput (createEmbeddedListField widget) ----

/** Cell type for one column of an embedded-list field. Mirrors
 *  EmbeddedListCellViewModel["type"] from `@cosmicdrift/kumiko-renderer/headless`. */
export type EmbeddedListCellType =
  | "text"
  | "number"
  | "boolean"
  | "date"
  | "money"
  | "decimal"
  | "select"
  | "reference"
  | "timestamp"
  | "images"
  | "files";

/** One column of an embedded-list table (one entry per key of the source
 *  EmbeddedFieldDef's `schema`). */
export type EmbeddedListColumn = {
  readonly field: string;
  readonly label: string;
  readonly type: EmbeddedListCellType;
  readonly required: boolean;
  /** Read-only, value supplied by the caller (already computed from
   *  sibling cells) — not directly user-editable. */
  readonly derived: boolean;
  /** Shown but not editable by the user; unlike `derived` it is not computed. */
  readonly readOnly?: boolean;
  /** Only for `type: "select"`. */
  readonly options?: readonly string[];
  readonly optionLabels?: Readonly<Record<string, string>>;
  /** Only for `type: "select"`; `"radio"` renders segmented buttons, the
   *  default is a dropdown. */
  readonly display?: "radio" | "dropdown";
  /** Only for `type: "reference"` — pre-fetched by the caller, ONE query
   *  per column shared across every row (not one query per cell). */
  readonly referenceOptions?: readonly { readonly value: string; readonly label: string }[];
  readonly referenceLoading?: boolean;
  /** Only for `type: "select"`; tone per option (selected segment, derived badge). */
  readonly optionTones?: Readonly<Partial<Record<string, SelectOptionTone>>>;
  /** Only for `type: "images" | "files"`. */
  readonly capture?: "user" | "environment";
  readonly maxCount?: number;
  readonly accept?: readonly string[];
  /** Per-row state, evaluated by the caller (conditions are engine logic the primitive must not import).
   *  A hidden cell keeps its value but shows no control. */
  readonly isHiddenInRow?: (row: Readonly<Record<string, unknown>>) => boolean;
  readonly isRequiredInRow?: (row: Readonly<Record<string, unknown>>) => boolean;
  /** Overrides `derived` per row: a conditional derived cell is editable on rows where it does not apply. */
  readonly isDerivedInRow?: (row: Readonly<Record<string, unknown>>) => boolean;
};

/** One entry of an embedded-list totals row (e.g. an invoice's total
 *  amount, summed across all rows by the caller). */
export type EmbeddedListTotal = {
  readonly field: string;
  readonly label: string;
  readonly value: number;
  /** Set for labelled multi-column totals, which have no single column to
   *  read the money type from. */
  readonly money?: boolean;
};

/** Row-array + totals table for a `createEmbeddedListField` (invoice-
 *  positions-style) field — structurally too different from `Input`'s
 *  value/onChange union to fit there, so it's its own primitive, same as
 *  `DataTable`. Controlled: the caller (the eventual form-field wrapper)
 *  computes rows/derived values/issue groups and wires every callback;
 *  this primitive only renders and reports interaction. */
export type EmbeddedListInputProps = {
  readonly id: string;
  readonly columns: readonly EmbeddedListColumn[];
  readonly rows: readonly Readonly<Record<string, unknown>>[];
  readonly totals?: readonly EmbeddedListTotal[];
  /** Currency for money cells and the totals row — one value for the whole
   *  list (currency lives on the head aggregate, not the row). Web impl
   *  falls back to "EUR" when absent. */
  readonly currency?: string;
  /** Whole-list read-only (e.g. a released invoice) — hides row-mutation
   *  affordances and disables every cell. */
  readonly disabled?: boolean;
  /** Rows are fixed: no add, remove, duplicate or move; cells stay editable. */
  readonly fixedRows?: boolean;
  readonly minItems?: number;
  readonly maxItems?: number;
  /** Upload target of file cells: `entityType`/`entityId`/`fieldName` of the list, the column name is the `subField`. */
  readonly uploadTarget?: {
    readonly entityType: string;
    readonly fieldName: string;
    readonly entityId?: string;
  };
  /** Shown under the whole list (e.g. under the totals row). */
  readonly listIssues?: readonly FieldIssue[];
  /** Keyed by row index. */
  readonly rowIssues?: Readonly<Record<number, readonly FieldIssue[]>>;
  /** Keyed `${rowIndex}.${field}`. */
  readonly cellIssues?: Readonly<Record<string, readonly FieldIssue[]>>;
  readonly onCellChange: (rowIndex: number, field: string, value: unknown) => void;
  readonly onAddRow: () => void;
  readonly onRemoveRow: (rowIndex: number) => void;
  readonly onDuplicateRow: (rowIndex: number) => void;
  readonly onMoveRow: (fromIndex: number, toIndex: number) => void;
  /** Tab/newline-delimited clipboard paste starting at (rowIndex,
   *  columnIndex) — parsed to a 2D string grid by the Web impl (paste
   *  events are a browser-only concept); undefined caller = no paste
   *  handling wired up. */
  readonly onPasteCells?: (
    rowIndex: number,
    columnIndex: number,
    grid: readonly (readonly string[])[],
  ) => void;
  readonly addLabel: string;
  /** Accessible name of the (otherwise headerless) row-actions column. */
  readonly actionsLabel: string;
  readonly removeLabel: string;
  readonly duplicateLabel: string;
  readonly moveUpLabel: string;
  readonly moveDownLabel: string;
  readonly emptyLabel: string;
  readonly emptyCtaLabel: string;
  readonly testId?: string;
};
