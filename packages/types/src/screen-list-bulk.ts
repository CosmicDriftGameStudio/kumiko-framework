export const LIST_BULK_ACTION_KEYS = ["id", "rowAction", "confirm"] as const;

/** Most rows one selection can hold; the loaded page caps it further. */
export const MAX_BULK_SELECTION = 100;

/** An action that runs a writeHandler row action once per checkbox-selected row. One `/api/write` per row, so access, validation and audit stay per row. */
export type ListBulkAction = {
  /** Stable id, kebab-case, unique among the screen's bulk actions. */
  readonly id: string;
  /** Id of a writeHandler entry in the same screen's `rowActions`; it supplies handler, payload, label, style and `visible`. Rows the action's `visible` hides are skipped. */
  readonly rowAction: string;
  /** i18n key of the one confirm dialog for the whole selection; gets `{count}` and `{action}`. Without it a `confirm` or `style: "danger"` on the row action still asks once with the default text. */
  readonly confirm?: string;
};
