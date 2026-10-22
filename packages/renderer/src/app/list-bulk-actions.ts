import type {
  ListBulkAction,
  RowAction,
  RowActionWriteHandler,
} from "@cosmicdrift/kumiko-framework/ui-types";
import { evalFieldCondition } from "@cosmicdrift/kumiko-framework/ui-types";
import { resolveActionIcon } from "@cosmicdrift/kumiko-types/action-icon";
import { useMemo } from "react";
import type { DataTableBulk, DataTableBulkAction } from "../data-table-bulk-types.ts";
import type { Dispatcher, ListRowViewModel, Translate } from "../headless/index.ts";
import { isWriteHandlerRowAction, refetchAfterWrite, writeRowAction } from "./row-actions.ts";
import { dispatcherErrorText } from "./write-failed-error.ts";

function asksForConfirm(bulk: ListBulkAction, rowAction: RowActionWriteHandler): boolean {
  return (
    bulk.confirm !== undefined || rowAction.confirm !== undefined || rowAction.style === "danger"
  );
}

function buildBulkAction(
  bulk: ListBulkAction,
  rowAction: RowActionWriteHandler,
  translate: Translate,
  dispatcher: Dispatcher,
): DataTableBulkAction {
  const label = translate(rowAction.label);
  const visible = rowAction.visible;
  const confirmKey = bulk.confirm ?? "kumiko.list.bulk.confirm";
  return {
    id: bulk.id,
    label,
    ...(rowAction.style !== undefined && { style: rowAction.style }),
    icon: resolveActionIcon(rowAction.id, rowAction.icon),
    ...(asksForConfirm(bulk, rowAction) && {
      confirmText: (count: number) => translate(confirmKey, { count, action: label }),
    }),
    ...(rowAction.confirmLabel !== undefined && {
      confirmLabel: translate(rowAction.confirmLabel),
    }),
    appliesTo: (row: ListRowViewModel) =>
      visible === undefined || evalFieldCondition(visible, row.values),
    writeRow: async (row: ListRowViewModel) => {
      const result = await writeRowAction(rowAction, row, dispatcher);
      return result.isSuccess
        ? { kind: "succeeded" }
        : { kind: "failed", message: dispatcherErrorText(result.error, translate) };
    },
  };
}

/** Resolves each bulk action against its writeHandler row action; one that resolves to nothing is dropped. */
export function buildListBulkActions(options: {
  readonly bulkActions: readonly ListBulkAction[];
  readonly rowActions: readonly RowAction[] | undefined;
  readonly translate: Translate;
  readonly dispatcher: Dispatcher;
}): readonly DataTableBulkAction[] {
  const { bulkActions, rowActions, translate, dispatcher } = options;
  return bulkActions.flatMap((bulk) => {
    const rowAction = rowActions?.find((action) => action.id === bulk.rowAction);
    if (rowAction === undefined || !isWriteHandlerRowAction(rowAction)) return [];
    return [buildBulkAction(bulk, rowAction, translate, dispatcher)];
  });
}

/** DataTable `bulk` prop of a list screen; undefined without bulk actions or dispatcher. */
export function useListBulk(options: {
  readonly bulkActions: readonly ListBulkAction[] | undefined;
  readonly rowActions: readonly RowAction[] | undefined;
  readonly translate: Translate;
  readonly dispatcher: Dispatcher | undefined;
  readonly reload: () => Promise<unknown>;
}): DataTableBulk | undefined {
  const { bulkActions, rowActions, translate, dispatcher, reload } = options;
  return useMemo(() => {
    if (bulkActions === undefined || dispatcher === undefined) return undefined;
    const actions = buildListBulkActions({ bulkActions, rowActions, translate, dispatcher });
    if (actions.length === 0) return undefined;
    return { actions, reload: () => refetchAfterWrite(reload) };
  }, [bulkActions, rowActions, translate, dispatcher, reload]);
}
