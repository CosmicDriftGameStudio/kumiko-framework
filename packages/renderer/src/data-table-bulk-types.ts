import type { IconKey } from "@cosmicdrift/kumiko-types/nav-icon";
import type { ListRowViewModel } from "./headless/index.ts";

export type BulkRowOutcome =
  | { readonly kind: "succeeded" }
  | { readonly kind: "failed"; readonly message: string };

type DataTableBulkActionBase = {
  readonly id: string;
  /** Translated label of the underlying row action or form action. */
  readonly label: string;
  readonly style?: "primary" | "secondary" | "danger";
  readonly icon?: IconKey;
  /** Present: one confirm dialog for the whole selection, with this text for `count` rows. */
  readonly confirmText?: (count: number) => string;
  readonly confirmLabel?: string;
};

export type DataTableBulkWriteAction = DataTableBulkActionBase & {
  /** False: the row action's `visible` hides it for this row; the run skips the row. */
  readonly appliesTo: (row: ListRowViewModel) => boolean;
  /** Exactly one server write for one row. Never throws for a rejected write. */
  readonly writeRow: (row: ListRowViewModel) => Promise<BulkRowOutcome>;
};

export type DataTableBulkFormAction = DataTableBulkActionBase & {
  /** Hands the whole selection to one form instead of running writes in the table. */
  readonly openForm: (rows: readonly ListRowViewModel[]) => void;
};

export type DataTableBulkAction = DataTableBulkWriteAction | DataTableBulkFormAction;

export function isBulkFormAction(action: DataTableBulkAction): action is DataTableBulkFormAction {
  return "openForm" in action;
}

export type DataTableBulk = {
  readonly actions: readonly DataTableBulkAction[];
  /** Reloads the list once after a run. */
  readonly reload: () => Promise<void>;
};
