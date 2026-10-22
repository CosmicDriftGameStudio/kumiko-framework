// A faceted filter slot in the toolbar: an outline dropdown button
// (like shadcn's "Columns" toggle) with multi-select checkboxes. KumikoScreen
// builds it from the entity's filterable select/boolean fields.
export type DataTableFacet = {
  /** Entity-Feldname (= URL-State-Key + payload.filters[].field). */
  readonly field: string;
  /** Translated Button-Label ("Status", "Active"). */
  readonly label: string;
  /** Selectable values with display labels. `value` is the raw filter value
   *  (a select option or `"true"`/`"false"`), transported as a string. */
  readonly options: readonly { readonly value: string; readonly label: string }[];
  /** Present: render the facet as a row of single-choice toggle chips instead
   *  of a dropdown. A chip is pressed while the selection equals its values. */
  readonly chips?: readonly DataTableFacetChip[];
  /** Chips only: show each chip's `count` next to its label. */
  readonly showCounts?: boolean;
  /** Chips only: hide chips whose `count` is 0 (unless pressed). */
  readonly hideEmpty?: boolean;
};

export type DataTableFacetChip = {
  readonly id: string;
  /** Translated chip label. */
  readonly label: string;
  /** Selection a click sets; `[]` clears the facet. */
  readonly values: readonly string[];
  /** Matching row count, undefined while unknown. */
  readonly count?: number;
};

// Time-range filter slot in the toolbar: two date inputs
// (from/to) instead of an options dropdown. Values are `YYYY-MM-DD` or ""
// (bound open) — the caller converts them into query params.
export type DataTableDateRangeFacet = {
  /** The facet's namespace (its date field) — a key, not a filter value. */
  readonly field: string;
  /** Translated label ("When"). */
  readonly label: string;
  readonly from: string;
  readonly to: string;
};
