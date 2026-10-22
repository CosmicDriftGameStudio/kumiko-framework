import { type ReactNode, useState } from "react";
import type { DataTableBulk, DataTableBulkAction } from "../../../data-table-bulk-types.ts";
import type { ListRowViewModel, Translate } from "../../../headless/index.ts";
import { useBulkRun } from "../../../hooks/use-bulk-run.ts";
import { useOptionalTranslation } from "../../../i18n.tsx";
import { cn } from "../../lib/cn.ts";
import { Checkbox } from "../../ui/checkbox.tsx";
import { TableCell, TableHead } from "../../ui/table.tsx";
import { cellTitle } from "../data-table-cell.tsx";
import { BulkSelectionBar } from "./bulk-selection-bar.tsx";
import { EXPAND_TOGGLE_CELL_CLASS } from "./table-chrome.tsx";
import type { PinnedCellProps } from "./use-column-pins.ts";
import { useRowSelection } from "./use-row-selection.ts";

export type BulkSelection = {
  readonly active: boolean;
  readonly bar: ReactNode;
  readonly onKeyboardSelect: ((rowId: string) => void) | undefined;
  readonly headerCell: (pin: PinnedCellProps) => ReactNode;
  readonly bodyCell: (row: ListRowViewModel, pin: PinnedCellProps) => ReactNode;
  readonly cardCheckbox: (row: ListRowViewModel) => ReactNode;
};

const INACTIVE: BulkSelection = {
  active: false,
  bar: null,
  onKeyboardSelect: undefined,
  headerCell: () => null,
  bodyCell: () => null,
  cardCheckbox: () => null,
};

const keyAsText: Translate = (key) => key;

// The checkbox sits inside a clickable row; its click must not open the row.
function stopRowClick(event: { stopPropagation: () => void }): void {
  event.stopPropagation();
}

/** Row checkboxes, the selection bar and the run flow of a table with bulk actions. */
export function useBulkSelection({
  bulk,
  rows,
  titleField,
  rowTestId,
  flush,
}: {
  readonly bulk: DataTableBulk | undefined;
  readonly rows: readonly ListRowViewModel[];
  readonly titleField: string | undefined;
  readonly rowTestId: (row: ListRowViewModel) => string;
  /** The table has no frame (scrollBody): the bar spans its full width. */
  readonly flush: boolean;
}): BulkSelection {
  const t = useOptionalTranslation() ?? keyAsText;
  const selection = useRowSelection(rows);
  const run = useBulkRun();
  const [pendingAction, setPendingAction] = useState<DataTableBulkAction | undefined>(undefined);
  const [resultActionLabel, setResultActionLabel] = useState("");
  if (bulk === undefined) return INACTIVE;

  const isRunning = run.state.phase === "running";
  const reload = bulk.reload;

  async function execute(action: DataTableBulkAction): Promise<void> {
    setPendingAction(undefined);
    setResultActionLabel(action.label);
    const result = await run.start(action, selection.selectedRows);
    // Failed rows stay selected for a retry; so do rows a cancel kept from running.
    selection.retainOnly(new Set([...result.failedIds, ...result.notStartedIds]));
    await reload();
  }

  function rowCheckbox(row: ListRowViewModel): ReactNode {
    const checked = selection.isSelected(row.id);
    const title = (titleField !== undefined ? cellTitle(row.values[titleField]) : undefined) ?? "";
    return (
      <Checkbox
        checked={checked}
        disabled={isRunning || (!checked && selection.isFull)}
        onCheckedChange={() => selection.toggle(row.id)}
        onClick={stopRowClick}
        aria-label={t("kumiko.list.bulk.select-row", { title })}
        data-testid={`${rowTestId(row)}-select`}
      />
    );
  }

  return {
    active: true,
    bar: (
      <BulkSelectionBar
        flush={flush}
        actions={bulk.actions}
        selectedCount={selection.selectedRows.length}
        isFull={selection.isFull}
        runState={run.state}
        resultActionLabel={resultActionLabel}
        pendingAction={pendingAction}
        t={t}
        onRequest={(action) => {
          if (action.confirmText !== undefined) setPendingAction(action);
          else void execute(action);
        }}
        onConfirm={(action) => void execute(action)}
        onConfirmClose={() => setPendingAction(undefined)}
        onCancel={run.cancel}
        onClear={selection.clear}
        onDismissResult={run.dismissResult}
      />
    ),
    onKeyboardSelect: isRunning ? undefined : selection.toggle,
    headerCell: (pin) => (
      <TableHead
        data-testid="column-select"
        className={cn(EXPAND_TOGGLE_CELL_CLASS, "text-center", pin.className)}
        style={pin.style}
      >
        <Checkbox
          checked={
            selection.allState === "all"
              ? true
              : selection.allState === "some"
                ? "indeterminate"
                : false
          }
          disabled={isRunning || rows.length === 0}
          onCheckedChange={selection.toggleAll}
          aria-label={t("kumiko.list.bulk.select-all")}
          data-testid="select-all"
        />
      </TableHead>
    ),
    bodyCell: (row, pin) => (
      <TableCell
        data-testid={`cell-${row.id}-select`}
        className={cn(EXPAND_TOGGLE_CELL_CLASS, "text-center", pin.className)}
        style={pin.style}
      >
        {rowCheckbox(row)}
      </TableCell>
    ),
    cardCheckbox: (row) => (
      <div className="flex size-11 shrink-0 items-center justify-center">{rowCheckbox(row)}</div>
    ),
  };
}
