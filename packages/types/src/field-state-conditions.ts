// Declarative field-state condition. Evaluated by the renderer against the
// current row/form values. Five forms:
//   boolean          — static on/off (e.g. readOnly: true)
//   { field, eq }    — true when row[field] === eq
//   { field, ne }    — true when row[field] !== ne
//   { field, in }    — true when row[field] is one of the given values
//   { field, notIn } — true when row[field] is none of the given values
// JSON-safe: survives buildAppSchema → GET /api/schema stringify.
export type FieldCondition =
  | boolean
  | { readonly field: string; readonly eq: unknown }
  | { readonly field: string; readonly ne: unknown }
  | { readonly field: string; readonly in: readonly unknown[] }
  | { readonly field: string; readonly notIn: readonly unknown[] };

export type FieldStateConditions = {
  /** Field is shown only while the condition holds on the record values. Hidden values are kept, never dropped. */
  readonly visibleWhen?: Exclude<FieldCondition, boolean>;
  /** Field is required while the condition holds (and the field is visible). Enforced by the server write path, not only the form. */
  readonly requiredWhen?: Exclude<FieldCondition, boolean>;
};

/** Value is an array of FileRef ids; `file_refs.fieldName` stays the top-level embedded field name. */
export type EmbeddedFilesSubFieldProps = {
  readonly maxSize?: string;
  readonly accept?: readonly string[];
  readonly maxCount?: number;
};

export type EmbeddedImagesSubFieldProps = EmbeddedFilesSubFieldProps & {
  readonly capture?: "environment" | "user";
};

/** A cell computed from other cells of the same row. `from` names the
 *  sub-fields the operation reads (order matters for `subtract`). Renderer
 *  metadata — the derived value is rounded server- and client-side to the
 *  precision its target sub-field in `schema` declares (money → integer,
 *  decimal → `scale`) before it's validated. */
export type EmbeddedDerivedCellDef = {
  /** Row-level condition on a sibling sub-field. When it does not hold for a row, the cell is not
   *  derived there: it stays a normal input and the row value is left untouched. */
  readonly when?: Exclude<FieldCondition, boolean>;
} & (
  | {
      /** `percent` = `from[0] * from[1] / 100` (exactly two sources, e.g. amount and rate). */
      readonly op: "multiply" | "sum" | "subtract" | "percent";
      readonly from: readonly string[];
    }
  | {
      /** `from` is exactly `[value, min, max]`; bounds are inclusive and each may be missing. */
      readonly op: "inRange";
      readonly from: readonly string[];
      readonly inside: string;
      readonly outside: string;
    }
);
