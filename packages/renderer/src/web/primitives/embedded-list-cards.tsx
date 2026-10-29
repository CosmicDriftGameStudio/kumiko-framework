// Mobile card layout for EmbeddedListInput. One card per row: the title, then
// one block per visible column. Columns marked hiddenInCard are skipped, and a
// column with cardAttachedTo sits unlabeled next to its anchor control.

import { Plus } from "lucide-react";
import type { ClipboardEvent, KeyboardEvent, ReactNode } from "react";
import type { FieldIssue } from "../../headless/index.ts";
import type { EmbeddedListColumn, EmbeddedListInputProps } from "../../index.ts";
import { useTranslation } from "../../index.ts";
import { Button as UiButton } from "../ui/button.tsx";
import {
  IssueMessages,
  isDerivedCell,
  RowActions,
  readOnlyCellText,
  renderCellControl,
} from "./embedded-list-cell.tsx";
import { formatLocaleNumber } from "./locale-number.ts";

export type EmbeddedListCardsProps = {
  readonly columns: readonly EmbeddedListColumn[];
  readonly rows: EmbeddedListInputProps["rows"];
  readonly titleColumn: EmbeddedListColumn | undefined;
  readonly lastEditableIndex: number;
  readonly rowIssues: EmbeddedListInputProps["rowIssues"];
  readonly cellIssues: EmbeddedListInputProps["cellIssues"];
  readonly listIssues: readonly FieldIssue[] | undefined;
  readonly totalsNode: ReactNode;
  readonly disabled: boolean;
  readonly showControls: boolean;
  readonly addDisabled: boolean;
  readonly minItems: number | undefined;
  readonly maxItems: number | undefined;
  readonly currency: string;
  readonly locale: string;
  readonly uploadTarget: EmbeddedListInputProps["uploadTarget"];
  readonly onCellChange: EmbeddedListInputProps["onCellChange"];
  readonly onAddRow: () => void;
  readonly onRemoveRow: (rowIndex: number) => void;
  readonly onDuplicateRow: (rowIndex: number) => void;
  readonly onMoveRow: (fromIndex: number, toIndex: number) => void;
  readonly handlePaste: (
    rowIndex: number,
    columnIndex: number,
  ) => (event: ClipboardEvent<HTMLElement>) => void;
  readonly handleLastCellKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  readonly pasteEnabled: boolean;
  readonly cellId: (rowIndex: number, field: string) => string;
  readonly cellLabel: (column: EmbeddedListColumn, rowIndex: number) => string;
  readonly testId: string | undefined;
  readonly addLabel: string;
  readonly duplicateLabel: string;
  readonly moveUpLabel: string;
  readonly moveDownLabel: string;
  readonly removeLabel: string;
};

function CardLimitsHint({
  limits,
  row,
  locale,
  testId,
}: {
  readonly limits: { readonly min: string; readonly max: string };
  readonly row: Readonly<Record<string, unknown>>;
  readonly locale: string;
  readonly testId: string | undefined;
}): ReactNode {
  const t = useTranslation();
  const rawMin = row[limits.min];
  const rawMax = row[limits.max];
  const min =
    typeof rawMin === "number" ? formatLocaleNumber(rawMin, locale, { grouping: true }) : undefined;
  const max =
    typeof rawMax === "number" ? formatLocaleNumber(rawMax, locale, { grouping: true }) : undefined;
  let text: string | undefined;
  if (min !== undefined && max !== undefined) {
    text = t("kumiko.field.embedded-list.limit-range", { min, max });
  } else if (min !== undefined) {
    text = t("kumiko.field.embedded-list.limit-min", { min });
  } else if (max !== undefined) {
    text = t("kumiko.field.embedded-list.limit-max", { max });
  }
  if (text === undefined) return null;
  return (
    <div data-testid={testId} className="text-xs text-muted-foreground">
      {text}
    </div>
  );
}

export function EmbeddedListCards(props: EmbeddedListCardsProps): ReactNode {
  const {
    columns,
    rows,
    titleColumn,
    lastEditableIndex,
    rowIssues,
    cellIssues,
    listIssues,
    totalsNode,
    disabled,
    showControls,
    addDisabled,
    minItems,
    maxItems,
    currency,
    locale,
    uploadTarget,
    onCellChange,
    onAddRow,
    onRemoveRow,
    onDuplicateRow,
    onMoveRow,
    handlePaste,
    handleLastCellKeyDown,
    pasteEnabled,
    cellId,
    cellLabel,
    testId,
    addLabel,
    duplicateLabel,
    moveUpLabel,
    moveDownLabel,
    removeLabel,
  } = props;
  const testIdFor = (suffix: string): string | undefined =>
    testId !== undefined ? `${testId}-${suffix}` : undefined;

  return (
    <div data-testid={testIdFor("mobile")} className="md:hidden flex flex-col gap-3">
      {rows.map((row, rowIndex) => {
        const isLastRow = rowIndex === rows.length - 1;
        const rowIssuesForRow = rowIssues?.[rowIndex];
        const isVisible = (column: EmbeddedListColumn): boolean =>
          column !== titleColumn &&
          column.hiddenInCard !== true &&
          column.isHiddenInRow?.(row) !== true;
        const renderControl = (column: EmbeddedListColumn): ReactNode =>
          renderCellControl({
            cellId: cellId(rowIndex, column.field),
            label: cellLabel(column, rowIndex),
            column,
            value: row[column.field],
            disabled,
            onChange: (value) => onCellChange(rowIndex, column.field, value),
            currency,
            locale,
            derived: isDerivedCell(column, row),
            touch: true,
            uploadTarget,
          });
        const renderIssues = (column: EmbeddedListColumn): ReactNode => (
          <IssueMessages
            issues={cellIssues?.[`${rowIndex}.${column.field}`]}
            testId={testIdFor(`cell-${rowIndex}-${column.field}-errors`)}
          />
        );
        const anchorHasAttachment = (anchor: EmbeddedListColumn): EmbeddedListColumn | undefined =>
          columns.find(
            (other) =>
              other.cardAttachedTo === anchor.field &&
              other.hiddenInCard !== true &&
              other.field !== anchor.field,
          );
        return (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: rows have no caller-guaranteed stable id; every cell is fully controlled (value+onChange), so reordering doesn't rely on DOM node identity surviving between renders.
            key={rowIndex}
            data-testid={testIdFor(`row-${rowIndex}`)}
            className="flex flex-col gap-3 rounded-lg border bg-card p-4"
          >
            {titleColumn !== undefined && (
              <div data-testid={testIdFor(`row-${rowIndex}-title`)} className="font-medium">
                {rowIndex + 1}{" "}
                {readOnlyCellText(titleColumn, row[titleColumn.field], currency, locale)}
              </div>
            )}
            {columns.map((column, columnIndex) => {
              if (!isVisible(column)) return null;
              const anchor =
                column.cardAttachedTo !== undefined
                  ? columns.find((other) => other.field === column.cardAttachedTo)
                  : undefined;
              if (anchor !== undefined && isVisible(anchor)) return null;
              const attached = anchorHasAttachment(column);
              const isLastCell = isLastRow && columnIndex === lastEditableIndex;
              const showLabel = column.cardAttachedTo === undefined;
              const control = (
                <div className={attached !== undefined ? "min-w-0 flex-1" : undefined}>
                  {renderControl(column)}
                  {column.cardLimits !== undefined && (
                    <CardLimitsHint
                      limits={column.cardLimits}
                      row={row}
                      locale={locale}
                      testId={testIdFor(`cell-${rowIndex}-${column.field}-limits`)}
                    />
                  )}
                </div>
              );
              return (
                // biome-ignore lint/a11y/noStaticElementInteractions: paste/keydown are delegated from the focusable cell control rendered inside, not direct interaction on this wrapper div.
                <div
                  key={column.field}
                  className="flex flex-col gap-1"
                  onPaste={pasteEnabled ? handlePaste(rowIndex, columnIndex) : undefined}
                  onKeyDown={isLastCell ? handleLastCellKeyDown : undefined}
                >
                  {showLabel && (
                    <span className="text-xs font-medium text-muted-foreground">
                      {column.label}
                      {column.isRequiredInRow?.(row) === true && " *"}
                    </span>
                  )}
                  {attached !== undefined ? (
                    <div className="flex items-start gap-3">
                      {control}
                      <div className="shrink-0">{renderControl(attached)}</div>
                    </div>
                  ) : (
                    control
                  )}
                  {renderIssues(column)}
                  {attached !== undefined && renderIssues(attached)}
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
                  buttonSizeClass="size-10"
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
      {totalsNode}
      <IssueMessages issues={listIssues} testId={testIdFor("list-issues")} />
    </div>
  );
}
