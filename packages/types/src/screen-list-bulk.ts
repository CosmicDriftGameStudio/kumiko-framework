import type { IconKey } from "./nav-icon.ts";

export const LIST_BULK_ACTION_KEYS = ["id", "rowAction", "confirm"] as const;

export const LIST_BULK_FORM_ACTION_KEYS = ["id", "label", "icon", "screen", "idsField"] as const;

/** Most rows one selection can hold; the loaded page caps it further. */
export const MAX_BULK_SELECTION = 100;

/** Runs a writeHandler row action once per checkbox-selected row. One `/api/write` per row, so access, validation and audit stay per row. */
export type ListBulkRowAction = {
  /** Stable id, kebab-case, unique among the screen's bulk actions. */
  readonly id: string;
  /** Id of a writeHandler entry in the same screen's `rowActions`; it supplies handler, payload, label, style and `visible`. Rows the action's `visible` hides are skipped. */
  readonly rowAction: string;
  /** i18n key of the one confirm dialog for the whole selection; gets `{count}` and `{action}`. Without it a `confirm` or `style: "danger"` on the row action still asks once with the default text. */
  readonly confirm?: string;
};

/** Opens an `actionForm` screen for the whole selection. The ids of all selected rows land as one `string[]` in `idsField`, so the form's handler runs once for all of them. */
export type ListBulkFormAction = {
  /** Stable id, kebab-case, unique among the screen's bulk actions. */
  readonly id: string;
  /** i18n key of the button label. */
  readonly label: string;
  readonly icon?: IconKey;
  /** Short id (same feature) or `<feature>:screen:<id>` of an `actionForm` screen. */
  readonly screen: string;
  /** Field of that form which receives the selected row ids: a `multiSelect` with `display: "count"`. The ids travel in memory, not in the URL. The client cap `MAX_BULK_SELECTION` is no protection: the form's write handler runs once, so access and audit no longer run per row. The handler must bound the list itself (`z.array(...).max(MAX_BULK_SELECTION)`) and check every id with a tenant-scoped detail, answering `failNotFound` for a foreign or unknown one. */
  readonly idsField: string;
};

/** An action over checkbox-selected rows: a writeHandler row action per row (`rowAction`) or one form for all rows (`screen` + `idsField`). */
export type ListBulkAction = ListBulkRowAction | ListBulkFormAction;
