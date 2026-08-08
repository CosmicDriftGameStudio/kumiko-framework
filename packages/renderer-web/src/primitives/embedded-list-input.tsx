// EmbeddedListInput — row/totals table for a createEmbeddedListField
// (invoice-positions-style) field. Controlled: rows, derived values, and
// issue groups are computed by the caller; this component only renders
// and reports interaction (cell edits, row add/remove/duplicate/move,
// paste).
//
// Only one of the two layouts (table for md+, cards below md) is mounted
// at a time, picked via useIsMobile — mounting both and toggling with
// `hidden`/`md:hidden` left two live inputs per cell sharing one DOM id
// (#1854). useIsMobile reports `false` for the first render regardless of
// viewport, so the `hidden md:block` / `md:hidden` classes stay on the
// wrapper divs too: on a phone that first (wrong) render is desktop but
// CSS-hidden, not a visible flash of the wrong layout.

import type { FieldIssue } from "@cosmicdrift/kumiko-headless";
import type {
  EmbeddedListCellType,
  EmbeddedListColumn,
  EmbeddedListInputProps,
  EmbeddedListTotal,
} from "@cosmicdrift/kumiko-renderer";
import { useTranslation } from "@cosmicdrift/kumiko-renderer";
import { ArrowDown, ArrowUp, Copy, Plus, Trash2 } from "lucide-react";
import {
  type ClipboardEvent,
  Fragment,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { cn } from "../lib/cn";
import { Button as UiButton } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Input as UiInput } from "../ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";
import { useIsMobile } from "../ui/use-mobile";
import { ComboboxInput } from "./combobox";
import { DateInput } from "./date-input";
import { formatMoney, MoneyInput } from "./money-input";
import { TimestampInput } from "./timestamp-input";

// `input[type=hidden]` excluded — ComboboxInput renders one as a plain
// name-carrier before its focusable trigger button.
const FOCUSABLE_SELECTOR = "input:not([type=hidden]), button, [tabindex]";

function columnWidthClass(type: EmbeddedListCellType): string {
  switch (type) {
    case "money":
    case "number":
    case "decimal":
    case "date":
      return "w-36";
    // Wider than a bare date — carries a date field plus a time input.
    case "timestamp":
      return "w-44";
    case "boolean":
      return "w-16";
    case "text":
    case "select":
    case "reference":
      return "min-w-[10rem]";
    default: {
      const exhaustiveCheck: never = type;
      return exhaustiveCheck;
    }
  }
}

function columnAlignClass(type: EmbeddedListCellType): string {
  switch (type) {
    case "money":
    case "number":
    case "decimal":
      return "text-right";
    case "boolean":
      return "text-center";
    case "date":
    case "timestamp":
    case "text":
    case "select":
    case "reference":
      return "text-left";
    default: {
      const exhaustiveCheck: never = type;
      return exhaustiveCheck;
    }
  }
}

function formatTotalValue(
  total: EmbeddedListTotal,
  columns: readonly EmbeddedListColumn[],
  currency: string,
): string {
  const column = columns.find((c) => c.field === total.field);
  if (column?.type === "money") return formatMoney(total.value, currency);
  return total.value.toLocaleString();
}

// Tab/newline-delimited clipboard text → 2D string grid. Not a regex
// parse — split on the literal delimiters, trim a trailing `\r` per line
// (Windows clipboard line endings).
function parsePasteGrid(text: string): readonly (readonly string[])[] {
  return text.split("\n").map((line) => {
    const withoutCr = line.endsWith("\r") ? line.slice(0, -1) : line;
    return withoutCr.split("\t");
  });
}

function IssueMessages({
  issues,
  testId,
}: {
  readonly issues: readonly FieldIssue[] | undefined;
  readonly testId?: string;
}): ReactNode {
  const t = useTranslation();
  if (issues === undefined || issues.length === 0) return null;
  return (
    <div role="alert" data-testid={testId} className="text-xs text-destructive">
      {issues.map((issue) => (
        <div key={`${issue.path}:${issue.code}`}>{t(issue.i18nKey, issue.params)}</div>
      ))}
    </div>
  );
}

function renderCellControl({
  cellId,
  column,
  value,
  disabled,
  onChange,
  currency,
}: {
  readonly cellId: string;
  readonly column: EmbeddedListColumn;
  readonly value: unknown;
  readonly disabled: boolean;
  readonly onChange: (value: unknown) => void;
  readonly currency: string;
}): ReactNode {
  const isDisabled = disabled || column.derived;

  switch (column.type) {
    case "text":
      return (
        <UiInput
          data-cell-id={cellId}
          type="text"
          disabled={isDisabled}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case "number":
    case "decimal":
      return (
        <UiInput
          data-cell-id={cellId}
          type="number"
          disabled={isDisabled}
          className="text-right tabular-nums"
          value={typeof value === "number" ? value : ""}
          onChange={(e) => {
            const raw = e.target.value;
            onChange(raw === "" ? undefined : Number(raw));
          }}
        />
      );
    case "boolean":
      return (
        <div className="flex justify-center">
          <Checkbox
            data-cell-id={cellId}
            disabled={isDisabled}
            checked={value === true}
            onCheckedChange={(checked) => onChange(checked === true)}
          />
        </div>
      );
    case "date":
      return (
        // ponytail: DateInput has no passthrough props for data-cell-id;
        // wrap it instead — the pendingFocusCellId effect walks into the
        // wrapper for its focusable descendant, so auto-focus still works.
        <div data-cell-id={cellId}>
          <DateInput
            id={cellId}
            name={cellId}
            value={typeof value === "string" ? value : ""}
            onChange={(v) => onChange(v)}
            disabled={isDisabled}
          />
        </div>
      );
    case "timestamp":
      return (
        // ponytail: same wrapper pattern as "date" — TimestampInput has no
        // data-cell-id passthrough either.
        <div data-cell-id={cellId}>
          <TimestampInput
            id={cellId}
            name={cellId}
            value={typeof value === "string" ? value : ""}
            onChange={(v) => onChange(v)}
            disabled={isDisabled}
          />
        </div>
      );
    case "money":
      return (
        <div data-cell-id={cellId}>
          <MoneyInput
            id={cellId}
            name={cellId}
            value={typeof value === "number" ? value : ""}
            onChange={(v) => onChange(v)}
            currency={currency}
            disabled={isDisabled}
          />
        </div>
      );
    case "select": {
      const options = (column.options ?? []).map((opt) => ({
        value: opt,
        label: column.optionLabels?.[opt] ?? opt,
      }));
      return (
        <div data-cell-id={cellId}>
          <ComboboxInput
            id={cellId}
            name={cellId}
            value={typeof value === "string" ? value : ""}
            onChange={(v) => onChange(v)}
            options={options}
            disabled={isDisabled}
          />
        </div>
      );
    }
    case "reference":
      return (
        <div data-cell-id={cellId}>
          <ComboboxInput
            id={cellId}
            name={cellId}
            value={typeof value === "string" ? value : ""}
            onChange={(v) => onChange(v)}
            options={column.referenceOptions ?? []}
            disabled={isDisabled}
            loading={column.referenceLoading}
          />
        </div>
      );
    default: {
      const exhaustiveCheck: never = column.type;
      return exhaustiveCheck;
    }
  }
}

type RowActionsProps = {
  readonly rowIndex: number;
  readonly rowsLength: number;
  readonly minItems: number | undefined;
  readonly maxItems: number | undefined;
  readonly onDuplicateRow: (rowIndex: number) => void;
  readonly onMoveRow: (fromIndex: number, toIndex: number) => void;
  readonly onRemoveRow: (rowIndex: number) => void;
  readonly duplicateLabel: string;
  readonly moveUpLabel: string;
  readonly moveDownLabel: string;
  readonly removeLabel: string;
  readonly testIdPrefix: string | undefined;
};

function RowActions({
  rowIndex,
  rowsLength,
  minItems,
  maxItems,
  onDuplicateRow,
  onMoveRow,
  onRemoveRow,
  duplicateLabel,
  moveUpLabel,
  moveDownLabel,
  removeLabel,
  testIdPrefix,
}: RowActionsProps): ReactNode {
  const duplicateDisabled = maxItems !== undefined && rowsLength >= maxItems;
  const removeDisabled = rowsLength <= (minItems ?? 0);
  return (
    <div className="inline-flex items-center gap-1">
      <UiButton
        type="button"
        variant="ghost"
        size="icon"
        aria-label={duplicateLabel}
        disabled={duplicateDisabled}
        onClick={() => onDuplicateRow(rowIndex)}
        data-testid={testIdPrefix !== undefined ? `${testIdPrefix}-duplicate` : undefined}
      >
        <Copy className="size-4" aria-hidden="true" />
      </UiButton>
      <UiButton
        type="button"
        variant="ghost"
        size="icon"
        aria-label={moveUpLabel}
        disabled={rowIndex === 0}
        onClick={() => onMoveRow(rowIndex, rowIndex - 1)}
        data-testid={testIdPrefix !== undefined ? `${testIdPrefix}-move-up` : undefined}
      >
        <ArrowUp className="size-4" aria-hidden="true" />
      </UiButton>
      <UiButton
        type="button"
        variant="ghost"
        size="icon"
        aria-label={moveDownLabel}
        disabled={rowIndex === rowsLength - 1}
        onClick={() => onMoveRow(rowIndex, rowIndex + 1)}
        data-testid={testIdPrefix !== undefined ? `${testIdPrefix}-move-down` : undefined}
      >
        <ArrowDown className="size-4" aria-hidden="true" />
      </UiButton>
      <UiButton
        type="button"
        variant="ghost"
        size="icon"
        aria-label={removeLabel}
        disabled={removeDisabled}
        onClick={() => onRemoveRow(rowIndex)}
        data-testid={testIdPrefix !== undefined ? `${testIdPrefix}-remove` : undefined}
      >
        <Trash2 className="size-4" aria-hidden="true" />
      </UiButton>
    </div>
  );
}

export function EmbeddedListInput({
  id,
  columns,
  rows,
  totals,
  currency,
  disabled,
  minItems,
  maxItems,
  listIssues,
  rowIssues,
  cellIssues,
  onCellChange,
  onAddRow,
  onRemoveRow,
  onDuplicateRow,
  onMoveRow,
  onPasteCells,
  addLabel,
  removeLabel,
  duplicateLabel,
  moveUpLabel,
  moveDownLabel,
  emptyLabel,
  emptyCtaLabel,
  testId,
}: EmbeddedListInputProps): ReactNode {
  // Callers that don't wire up the field-currency plumbing (or direct
  // callers/tests that predate #1839) keep getting the same "EUR" this
  // component always hardcoded.
  const effectiveCurrency = currency ?? "EUR";
  const isMobile = useIsMobile();
  const containerRef = useRef<HTMLDivElement>(null);
  const [pendingFocusCellId, setPendingFocusCellId] = useState<string | undefined>(undefined);

  // React 19 batches the setPendingFocusCellId + onAddRow calls from the
  // same keydown handler into one commit, so the new row already exists
  // by the time this effect runs — no need to depend on rows.length too.
  useEffect(() => {
    if (pendingFocusCellId === undefined) return;
    // ponytail: capability-scoped DOM query, not a global — degrades to
    // "no auto-focus" on a hypothetical native impl instead of crashing.
    // `data-cell-id` sits on the focusable control itself for text/boolean
    // cells, but on a non-focusable wrapper `<div>` for date/money/select/
    // reference/timestamp cells (see renderCellControl) — walk into the
    // wrapper for its focusable descendant instead of calling .focus() on
    // a div. `input[type=hidden]` excluded: ComboboxInput (select/reference)
    // renders a hidden name-carrier input before its trigger button — it
    // would otherwise win the "first match in document order" query
    // without ever actually receiving focus.
    const matched = containerRef.current?.querySelector<HTMLElement>(
      `[data-cell-id="${pendingFocusCellId}"]`,
    );
    const target = matched?.matches(FOCUSABLE_SELECTOR)
      ? matched
      : (matched?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR) ?? matched);
    target?.focus();
    setPendingFocusCellId(undefined);
  }, [pendingFocusCellId]);

  const cellId = (rowIndex: number, field: string): string => `${id}-${rowIndex}-${field}`;

  const showControls = disabled !== true;
  const addDisabled = maxItems !== undefined && rows.length >= maxItems;

  const handlePaste = (rowIndex: number, columnIndex: number) => {
    return (event: ClipboardEvent<HTMLElement>): void => {
      if (onPasteCells === undefined) return;
      const text = event.clipboardData?.getData("text") ?? "";
      const grid = parsePasteGrid(text);
      const isMultiCell = grid.length > 1 || (grid[0]?.length ?? 0) > 1;
      if (!isMultiCell) return;
      event.preventDefault();
      onPasteCells(rowIndex, columnIndex, grid);
    };
  };

  const handleLastCellKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (disabled === true) return;
    const isTabForward = event.key === "Tab" && !event.shiftKey;
    const isEnter = event.key === "Enter";
    if (!isTabForward && !isEnter) return;
    if (maxItems !== undefined && rows.length >= maxItems) return;
    // Enter bubbles up from the cell control through this TableCell — an
    // ancestor of any <form> the caller wraps the whole field in.
    // preventDefault() during the bubble phase still stops that form's
    // default submit, same as it stops Tab's default focus-move below.
    event.preventDefault();
    const firstColumn = columns[0];
    if (firstColumn !== undefined) {
      setPendingFocusCellId(cellId(rows.length, firstColumn.field));
    }
    onAddRow();
  };

  const testIdFor = (suffix: string): string | undefined =>
    testId !== undefined ? `${testId}-${suffix}` : undefined;

  if (rows.length === 0) {
    return (
      <div
        ref={containerRef}
        data-testid={testId !== undefined ? `${testId}-empty` : "embedded-list-empty"}
        className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground"
      >
        <span>{emptyLabel}</span>
        {showControls && (
          <UiButton
            type="button"
            variant="outline"
            size="sm"
            onClick={onAddRow}
            data-testid={testId !== undefined ? `${testId}-empty-add` : "embedded-list-empty-add"}
          >
            <Plus className="size-4" aria-hidden="true" />
            {emptyCtaLabel}
          </UiButton>
        )}
      </div>
    );
  }

  const hasTotals = totals !== undefined && totals.length > 0;

  return (
    <div ref={containerRef} data-testid={testId}>
      {/* ---- Desktop: table ---- */}
      {!isMobile && (
        <div data-testid={testIdFor("desktop")} className="hidden md:block">
          <div className="overflow-hidden rounded-lg border bg-card">
            <Table>
              <TableHeader className="bg-muted">
                <TableRow className="hover:bg-transparent">
                  {columns.map((column) => (
                    <TableHead
                      key={column.field}
                      className={cn(columnWidthClass(column.type), columnAlignClass(column.type))}
                    >
                      {column.label}
                    </TableHead>
                  ))}
                  {showControls && <TableHead className="w-px text-right" aria-label="Actions" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row, rowIndex) => {
                  const isLastRow = rowIndex === rows.length - 1;
                  const rowIssuesForRow = rowIssues?.[rowIndex];
                  return (
                    <Fragment
                      // biome-ignore lint/suspicious/noArrayIndexKey: rows have no caller-guaranteed stable id; every cell is fully controlled (value+onChange), so reordering doesn't rely on DOM node identity surviving between renders.
                      key={rowIndex}
                    >
                      <TableRow data-testid={testIdFor(`row-${rowIndex}`)}>
                        {columns.map((column, columnIndex) => {
                          const isLastCell = isLastRow && columnIndex === columns.length - 1;
                          const issues = cellIssues?.[`${rowIndex}.${column.field}`];
                          return (
                            <TableCell
                              key={column.field}
                              data-testid={testIdFor(`cell-${rowIndex}-${column.field}`)}
                              className={columnWidthClass(column.type)}
                              onPaste={
                                onPasteCells !== undefined
                                  ? handlePaste(rowIndex, columnIndex)
                                  : undefined
                              }
                              onKeyDown={isLastCell ? handleLastCellKeyDown : undefined}
                            >
                              {renderCellControl({
                                cellId: cellId(rowIndex, column.field),
                                column,
                                value: row[column.field],
                                disabled: disabled === true,
                                onChange: (value) => onCellChange(rowIndex, column.field, value),
                                currency: effectiveCurrency,
                              })}
                              <IssueMessages
                                issues={issues}
                                testId={testIdFor(`cell-${rowIndex}-${column.field}-errors`)}
                              />
                            </TableCell>
                          );
                        })}
                        {showControls && (
                          <TableCell className="text-right">
                            <RowActions
                              rowIndex={rowIndex}
                              rowsLength={rows.length}
                              minItems={minItems}
                              maxItems={maxItems}
                              onDuplicateRow={onDuplicateRow}
                              onMoveRow={onMoveRow}
                              onRemoveRow={onRemoveRow}
                              duplicateLabel={duplicateLabel}
                              moveUpLabel={moveUpLabel}
                              moveDownLabel={moveDownLabel}
                              removeLabel={removeLabel}
                              testIdPrefix={testIdFor(`row-${rowIndex}`)}
                            />
                          </TableCell>
                        )}
                      </TableRow>
                      {rowIssuesForRow !== undefined && rowIssuesForRow.length > 0 && (
                        <TableRow>
                          <TableCell colSpan={columns.length + (showControls ? 1 : 0)}>
                            <IssueMessages
                              issues={rowIssuesForRow}
                              testId={testIdFor(`row-${rowIndex}-issues`)}
                            />
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  );
                })}
                {showControls && (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={columns.length + 1} className="p-2">
                      <UiButton
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={onAddRow}
                        disabled={addDisabled}
                        data-testid={testIdFor("add")}
                      >
                        <Plus className="size-4" aria-hidden="true" />
                        {addLabel}
                      </UiButton>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
            {hasTotals && (
              <div
                data-testid={testIdFor("totals")}
                className="flex flex-wrap items-center justify-end gap-6 border-t bg-muted/30 px-4 py-3 text-sm"
              >
                {totals.map((total) => (
                  <div key={total.field} className="flex items-baseline gap-2">
                    <span className="text-muted-foreground">{total.label}</span>
                    <span className="font-medium tabular-nums">
                      {formatTotalValue(total, columns, effectiveCurrency)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <IssueMessages issues={listIssues} testId={testIdFor("list-issues")} />
        </div>
      )}

      {/* ---- Mobile: cards ---- */}
      {isMobile && (
        <div data-testid={testIdFor("mobile")} className="md:hidden flex flex-col gap-3">
          {rows.map((row, rowIndex) => {
            const isLastRow = rowIndex === rows.length - 1;
            const rowIssuesForRow = rowIssues?.[rowIndex];
            return (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: rows have no caller-guaranteed stable id; every cell is fully controlled (value+onChange), so reordering doesn't rely on DOM node identity surviving between renders.
                key={rowIndex}
                data-testid={testIdFor(`row-${rowIndex}`)}
                className="flex flex-col gap-3 rounded-lg border bg-card p-4"
              >
                {columns.map((column, columnIndex) => {
                  const isLastCell = isLastRow && columnIndex === columns.length - 1;
                  const issues = cellIssues?.[`${rowIndex}.${column.field}`];
                  return (
                    // biome-ignore lint/a11y/noStaticElementInteractions: paste/keydown are delegated from the focusable cell control rendered inside, not direct interaction on this wrapper div.
                    <div
                      key={column.field}
                      className="flex flex-col gap-1"
                      onPaste={
                        onPasteCells !== undefined ? handlePaste(rowIndex, columnIndex) : undefined
                      }
                      onKeyDown={isLastCell ? handleLastCellKeyDown : undefined}
                    >
                      <span className="text-xs font-medium text-muted-foreground">
                        {column.label}
                      </span>
                      {renderCellControl({
                        cellId: cellId(rowIndex, column.field),
                        column,
                        value: row[column.field],
                        disabled: disabled === true,
                        onChange: (value) => onCellChange(rowIndex, column.field, value),
                        currency: effectiveCurrency,
                      })}
                      <IssueMessages
                        issues={issues}
                        testId={testIdFor(`cell-${rowIndex}-${column.field}-errors`)}
                      />
                    </div>
                  );
                })}
                {rowIssuesForRow !== undefined && rowIssuesForRow.length > 0 && (
                  <IssueMessages
                    issues={rowIssuesForRow}
                    testId={testIdFor(`row-${rowIndex}-issues`)}
                  />
                )}
                {showControls && (
                  <div className="flex items-center justify-end gap-1 border-t pt-3">
                    <RowActions
                      rowIndex={rowIndex}
                      rowsLength={rows.length}
                      minItems={minItems}
                      maxItems={maxItems}
                      onDuplicateRow={onDuplicateRow}
                      onMoveRow={onMoveRow}
                      onRemoveRow={onRemoveRow}
                      duplicateLabel={duplicateLabel}
                      moveUpLabel={moveUpLabel}
                      moveDownLabel={moveDownLabel}
                      removeLabel={removeLabel}
                      testIdPrefix={testIdFor(`row-${rowIndex}`)}
                    />
                  </div>
                )}
              </div>
            );
          })}
          {showControls && (
            <UiButton
              type="button"
              variant="outline"
              onClick={onAddRow}
              disabled={addDisabled}
              data-testid={testIdFor("add")}
            >
              <Plus className="size-4" aria-hidden="true" />
              {addLabel}
            </UiButton>
          )}
          {hasTotals && (
            <div
              data-testid={testIdFor("totals")}
              className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-4 text-sm"
            >
              {totals.map((total) => (
                <div key={total.field} className="flex items-center justify-between">
                  <span className="text-muted-foreground">{total.label}</span>
                  <span className="font-medium tabular-nums">
                    {formatTotalValue(total, columns, effectiveCurrency)}
                  </span>
                </div>
              ))}
            </div>
          )}
          <IssueMessages issues={listIssues} testId={testIdFor("list-issues")} />
        </div>
      )}
    </div>
  );
}
