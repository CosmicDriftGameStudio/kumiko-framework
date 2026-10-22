import type { IconKey } from "@cosmicdrift/kumiko-types/nav-icon";
import type { ListRowViewModel } from "./headless/index.ts";

export type BulkRowOutcome =
  | { readonly kind: "succeeded" }
  | { readonly kind: "failed"; readonly message: string };

export type DataTableBulkAction = {
  readonly id: string;
  /** Translated label of the underlying row action. */
  readonly label: string;
  readonly style?: "primary" | "secondary" | "danger";
  readonly icon?: IconKey;
  /** Present: one confirm dialog for the whole selection, with this text for `count` rows. */
  readonly confirmText?: (count: number) => string;
  readonly confirmLabel?: string;
  /** False: the row action's `visible` hides it for this row; the run skips the row. */
  readonly appliesTo: (row: ListRowViewModel) => boolean;
  /** Exactly one server write for one row. Never throws for a rejected write. */
  readonly writeRow: (row: ListRowViewModel) => Promise<BulkRowOutcome>;
};

export type DataTableBulk = {
  readonly actions: readonly DataTableBulkAction[];
  /** Reloads the list once after a run. */
  readonly reload: () => Promise<void>;
};
