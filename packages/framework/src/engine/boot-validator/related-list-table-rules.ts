import { isPlainObject } from "@cosmicdrift/kumiko-types/type-guards";

const EXPANDABLE_ROW_TABLE_KEYS: ReadonlySet<string> = new Set(["grouping"]);
const EXPANDABLE_ROW_REJECTED_GROUPING_KEYS = ["userChoice", "fields"] as const;

// `groupBy` grouped the loaded page on the client; it is gone, and a screen
// still carrying it fails at boot instead of silently losing its groups.
function rejectRemovedGroupBy(prefix: string, section: object): void {
  if (Object.hasOwn(section, "groupBy")) {
    throw new Error(
      `${prefix} uses groupBy, which was removed. Use table.grouping: { field, label?, labels?, collapsedWhen? }; ` +
        `groups and counts come from the server, so the bound query must accept aggregate.`,
    );
  }
}

function rejectExpandableRowTableOptions(prefix: string, table: unknown): void {
  if (isPlainObject(table)) {
    rejectUnsupportedTableKeys(prefix, table);
    rejectGroupingChoice(prefix, table["grouping"]);
  }
}

function rejectUnsupportedTableKeys(prefix: string, table: Record<string, unknown>): void {
  const unsupported = Object.keys(table).filter((key) => !EXPANDABLE_ROW_TABLE_KEYS.has(key));
  if (unsupported.length > 0) {
    throw new Error(
      `${prefix} supports only table.grouping, not table.${unsupported.join(", table.")}. ` +
        `Put the other table options on the entityList screen itself.`,
    );
  }
}

function rejectGroupingChoice(prefix: string, grouping: unknown): void {
  const choiceKey = isPlainObject(grouping)
    ? EXPANDABLE_ROW_REJECTED_GROUPING_KEYS.find((key) => Object.hasOwn(grouping, key))
    : undefined;
  if (choiceKey !== undefined) {
    throw new Error(
      `${prefix} does not support table.grouping.${choiceKey}: an expanded row has no view menu. ` +
        `Set a fixed table.grouping.field.`,
    );
  }
}

/** Grouping rules of a relatedList section or entityList.expandableRow, before the shared table checks. */
export function validateRelatedListGroupingRules(
  prefix: string,
  section: { readonly table?: unknown },
  isExpandableRow: boolean,
): void {
  rejectRemovedGroupBy(prefix, section);
  if (isExpandableRow && Object.hasOwn(section, "bulkActions")) {
    throw new Error(
      `${prefix} does not support bulkActions. Put bulkActions on the entityList screen itself.`,
    );
  }
  if (isExpandableRow) rejectExpandableRowTableOptions(prefix, section.table);
}
