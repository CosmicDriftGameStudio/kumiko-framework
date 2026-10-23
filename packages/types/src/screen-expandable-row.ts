import type { EditRelatedListSection } from "./screen-entity-edit.ts";
import type { ListTableGrouping } from "./screen-list-table.ts";

/** Server-side grouping of an expandable row's sub-list: a fixed `field`, no "Group by" choice. */
export type ExpandableRowGrouping = Omit<ListTableGrouping, "field" | "userChoice" | "fields"> & {
  readonly field: string;
};

/** Expandable area of an `entityList` row: a relatedList of the row's record.
 *  `id` (tab id) and `countField` (tab badge) have no meaning outside a tabs
 *  layout and are therefore omitted. `kind` stays the discriminator so further
 *  expansion kinds can be added without a breaking change. `table` takes only
 *  `grouping`; the other table options belong on the entityList itself. */
export type EntityListExpandableRow = Omit<
  EditRelatedListSection,
  "id" | "countField" | "table" | "bulkActions"
> & {
  readonly table?: { readonly grouping?: ExpandableRowGrouping };
};
