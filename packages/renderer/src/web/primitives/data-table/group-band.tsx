import type { ReactNode } from "react";
import type {
  DataTableServerGroup,
  DataTableServerGroups,
} from "../../../data-table-aggregate-types.ts";
import type { ListColumnViewModel, ListRowViewModel } from "../../../headless/index.ts";
import { useOptionalTranslation } from "../../../index.ts";
import type { DataTableRowGrouping } from "../../../primitives.tsx";
import { Button as UiButton } from "../../ui/button.tsx";
import { buildTableItems, type TableItem } from "../data-table-cell.tsx";
import { RowGroupToggle } from "./row-group-toggle.tsx";
import { ServerGroupHeader } from "./server-group-header.tsx";

type ServerGroupItem = {
  readonly group: DataTableServerGroup;
  readonly owner: DataTableServerGroups;
};

export type DataTableItem =
  | TableItem
  | ({ readonly kind: "serverGroup" } & ServerGroupItem)
  | ({ readonly kind: "groupMore" } & ServerGroupItem);

export type DataTableBandItem = Exclude<DataTableItem, { readonly kind: "row" }>;

/** Server groups slice the flat `rows` by each group's `rowCount`, in group order. */
export function buildDataTableItems(
  rows: readonly ListRowViewModel[],
  rowGrouping: DataTableRowGrouping | undefined,
  toggledGroups: ReadonlySet<string>,
  serverGroups: DataTableServerGroups | undefined,
): readonly DataTableItem[] {
  if (serverGroups === undefined) return buildTableItems(rows, rowGrouping, toggledGroups);
  const items: DataTableItem[] = [];
  let offset = 0;
  for (const group of serverGroups.groups) {
    items.push({ kind: "serverGroup", group, owner: serverGroups });
    const members = rows.slice(offset, offset + group.rowCount);
    offset += group.rowCount;
    if (group.collapsed) continue;
    for (const row of members) items.push({ kind: "row", row });
    if (group.hasMore || group.loading)
      items.push({ kind: "groupMore", group, owner: serverGroups });
  }
  return items;
}

function bandGroupKey(item: DataTableBandItem): string {
  return item.kind === "group" ? item.key : item.group.key;
}

export function bandReactKey(item: DataTableBandItem): string {
  return `group-${bandGroupKey(item)}${item.kind === "groupMore" ? "-more" : ""}`;
}

export function bandTestId(item: DataTableBandItem): string {
  return `row-group-${bandGroupKey(item)}${item.kind === "groupMore" ? "-more" : ""}`;
}

export function bandClassName(item: DataTableBandItem): string {
  return item.kind === "groupMore" ? "p-0" : "bg-muted/40 p-0";
}

function GroupLoadMore({ item }: { readonly item: ServerGroupItem }): ReactNode {
  const translate = useOptionalTranslation();
  const { group, owner } = item;
  return (
    <div className="flex items-center gap-3 px-4 py-1.5 text-xs text-muted-foreground">
      <UiButton
        type="button"
        variant="ghost"
        size="sm"
        disabled={group.loading}
        onClick={() => owner.onLoadMore(group.key)}
        data-testid={`row-group-${group.key}-load-more`}
      >
        {group.loading
          ? (translate?.("kumiko.list.group.loading") ?? "Loading…")
          : (translate?.("kumiko.list.group.load-more") ?? "Load more")}
      </UiButton>
      <span className="tabular-nums">
        {translate?.("kumiko.list.group.loaded", {
          loaded: group.rowCount.toLocaleString(),
          count: group.count.toLocaleString(),
        }) ?? `${group.rowCount} / ${group.count}`}
      </span>
    </div>
  );
}

export function GroupBand({
  item,
  columnOf,
  onClientToggle,
}: {
  readonly item: DataTableBandItem;
  readonly columnOf: (field: string) => ListColumnViewModel | undefined;
  readonly onClientToggle: (key: string) => void;
}): ReactNode {
  switch (item.kind) {
    case "group":
      return (
        <RowGroupToggle
          groupKey={item.key}
          collapsed={item.collapsed}
          label={item.label}
          onToggle={onClientToggle}
        />
      );
    case "serverGroup":
      return (
        <ServerGroupHeader
          group={item.group}
          groupColumn={columnOf(item.owner.field)}
          columnOf={columnOf}
          onToggle={item.owner.onToggle}
          onVisible={item.owner.onHeaderVisible}
        />
      );
    case "groupMore":
      return <GroupLoadMore item={item} />;
  }
}
