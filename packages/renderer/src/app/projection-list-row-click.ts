import type {
  ProjectionListScreenDefinition,
  RowActionNavigate,
} from "@cosmicdrift/kumiko-framework/ui-types";
import type { ListRowViewModel } from "../headless/index.ts";
import type { useDrawerAction } from "./action-form-body.tsx";
import { findRowClickAction, runDrawerRowAction } from "./row-actions.ts";

type RowClickInput = {
  readonly screen: ProjectionListScreenDefinition;
  readonly onRowClick: ((row: ListRowViewModel, entityName: string) => void) | undefined;
  readonly entityName: string;
  readonly openDrawer: ReturnType<typeof useDrawerAction>["openDrawer"];
  readonly runNavigate: (action: RowActionNavigate, row: ListRowViewModel) => unknown;
};

export function resolveWrappedRowClick(
  input: RowClickInput,
): ((row: ListRowViewModel) => void) | undefined {
  const { screen, onRowClick, entityName, openDrawer, runNavigate } = input;
  const rowClickAction = findRowClickAction(screen.rowActions);
  if (rowClickAction) {
    return (row: ListRowViewModel) =>
      rowClickAction.kind === "drawer"
        ? runDrawerRowAction(rowClickAction, openDrawer, row)
        : runNavigate(rowClickAction, row);
  }
  // skip: no row-click wiring when neither the screen nor the host supplies a handler
  if (onRowClick === undefined) return undefined;
  return (row: ListRowViewModel) => onRowClick(row, entityName);
}
