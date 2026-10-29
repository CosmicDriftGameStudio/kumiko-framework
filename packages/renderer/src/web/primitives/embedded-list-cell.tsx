import { ArrowDown, ArrowUp, Copy, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import { fieldIssueText } from "../../field-issue-text.ts";
import { fileIdsOf } from "../../file-ids-of.ts";
import { applyFormatSpec, type FieldIssue } from "../../headless/index.ts";
import type {
  EmbeddedListCellType,
  EmbeddedListColumn,
  EmbeddedListInputProps,
} from "../../index.ts";
import { useTranslation } from "../../index.ts";
import { cn } from "../lib/cn.ts";
import { Button as UiButton } from "../ui/button.tsx";
import { Checkbox } from "../ui/checkbox.tsx";
import { Input as UiInput } from "../ui/input.tsx";
import { ComboboxInput } from "./combobox.tsx";
import { selectPill } from "./data-table-cell.tsx";
import { DateInput } from "./date-input.tsx";
import { EmbeddedFileCell } from "./embedded-file-cell.tsx";
import { formatLocaleNumber } from "./locale-number.ts";
import { formatMoney, MoneyInput } from "./money-input.tsx";
import { NumberInput } from "./number-input.tsx";
import { SegmentedControl } from "./segmented-select.tsx";
import { TimestampInput } from "./timestamp-input.tsx";

export function columnAlignClass(type: EmbeddedListCellType): string {
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
    case "images":
    case "files":
      return "text-left";
    default: {
      const exhaustiveCheck: never = type;
      return exhaustiveCheck;
    }
  }
}

export function IssueMessages({
  issues,
  testId,
  constrainWidth,
}: {
  readonly issues: readonly FieldIssue[] | undefined;
  readonly testId?: string;
  // Table cells sit inside a table that scrolls horizontally (see
  // EmbeddedListInput below): a long, unbounded message there widens the
  // column instead of wrapping, forcing horizontal scroll. Only the desktop table-cell path
  // needs this — mobile cards and full-width row/list issues wrap naturally.
  readonly constrainWidth?: boolean;
}): ReactNode {
  const t = useTranslation();
  if (issues === undefined || issues.length === 0) return null;
  return (
    <div
      role="alert"
      data-testid={testId}
      className={cn(
        "text-xs text-destructive",
        constrainWidth === true && "max-w-[16rem] whitespace-normal break-words",
      )}
    >
      {issues.map((issue) => (
        <div key={`${issue.path}:${issue.code}`}>{fieldIssueText(t, issue)}</div>
      ))}
    </div>
  );
}

export function readOnlyCellText(
  column: EmbeddedListColumn,
  value: unknown,
  currency: string,
  locale: string,
): string {
  if (value === null || value === undefined || value === "") return "";
  switch (column.type) {
    case "boolean":
      return value === true ? "✓" : "";
    case "date":
    case "timestamp":
      return applyFormatSpec({ format: column.type, locale }, value);
    case "number":
    case "decimal":
      return typeof value === "number"
        ? formatLocaleNumber(value, locale, { grouping: true })
        : String(value);
    case "money":
      return typeof value === "number" ? formatMoney(value, currency, locale) : String(value);
    case "select":
      return typeof value === "string" ? (column.optionLabels?.[value] ?? value) : String(value);
    case "reference":
      return typeof value === "string"
        ? (column.referenceOptions?.find((o) => o.value === value)?.label ?? value)
        : String(value);
    case "text":
      return String(value);
    case "images":
    case "files":
      return String(fileIdsOf(value).length);
    default: {
      const exhaustiveCheck: never = column.type;
      return exhaustiveCheck;
    }
  }
}

export function isDerivedCell(
  column: EmbeddedListColumn,
  row: Readonly<Record<string, unknown>>,
): boolean {
  return column.isDerivedInRow?.(row) ?? column.derived;
}

export function renderCellControl({
  cellId,
  column,
  label,
  value,
  disabled,
  onChange,
  currency,
  locale,
  derived,
  touch,
  uploadTarget,
}: {
  readonly derived: boolean;
  readonly touch: boolean;
  readonly uploadTarget: EmbeddedListInputProps["uploadTarget"];
  readonly cellId: string;
  readonly label: string;
  readonly column: EmbeddedListColumn;
  readonly value: unknown;
  readonly disabled: boolean;
  readonly onChange: (value: unknown) => void;
  readonly currency: string;
  readonly locale: string;
}): ReactNode {
  if (column.readOnly === true && !derived) {
    return (
      <div
        data-cell-id={cellId}
        data-readonly-cell=""
        className={cn(
          "min-w-0 whitespace-normal break-words py-1.5 text-sm",
          columnAlignClass(column.type),
        )}
      >
        {readOnlyCellText(column, value, currency, locale)}
      </div>
    );
  }
  const isDisabled = disabled || derived;
  const controlHeight = touch ? "h-11" : undefined;

  switch (column.type) {
    case "text":
      return (
        <UiInput
          data-cell-id={cellId}
          type="text"
          aria-label={label}
          className={cn("min-w-0", controlHeight)}
          disabled={isDisabled}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case "number":
    case "decimal":
      return (
        <div data-cell-id={cellId} className="w-full min-w-0">
          <NumberInput
            id={cellId}
            name={cellId}
            ariaLabel={label}
            locale={locale}
            value={typeof value === "number" ? value : ""}
            onChange={(v) => onChange(v)}
            disabled={isDisabled}
            className={cn("text-right", controlHeight)}
          />
        </div>
      );
    case "boolean":
      return (
        <div className="flex justify-center">
          <Checkbox
            data-cell-id={cellId}
            aria-label={label}
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
        <div data-cell-id={cellId} className="w-full min-w-0">
          <DateInput
            id={cellId}
            name={cellId}
            ariaLabel={label}
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
        <div data-cell-id={cellId} className="w-full min-w-0">
          <TimestampInput
            id={cellId}
            name={cellId}
            ariaLabel={label}
            value={typeof value === "string" ? value : ""}
            onChange={(v) => onChange(v)}
            disabled={isDisabled}
          />
        </div>
      );
    case "money":
      return (
        <div data-cell-id={cellId} className="w-full min-w-0">
          <MoneyInput
            id={cellId}
            name={cellId}
            ariaLabel={label}
            value={typeof value === "number" ? value : ""}
            onChange={(v) => onChange(v)}
            currency={currency}
            disabled={isDisabled}
          />
        </div>
      );
    case "images":
    case "files":
      return (
        <EmbeddedFileCell
          cellId={cellId}
          label={label}
          column={column}
          value={value}
          readOnly={isDisabled}
          uploadTarget={uploadTarget}
          onChange={onChange}
        />
      );
    case "select": {
      if (derived) {
        return (
          <div data-cell-id={cellId} className="min-w-0 py-1.5">
            {selectPill(value, column.optionLabels, column.optionTones, locale, undefined)}
          </div>
        );
      }
      const options = (column.options ?? []).map((opt) => ({
        value: opt,
        label: column.optionLabels?.[opt] ?? opt,
      }));
      if (column.display === "radio" && options.length > 0) {
        return (
          <div data-cell-id={cellId} className="w-full min-w-0">
            <SegmentedControl
              id={cellId}
              name={cellId}
              labelProps={{ "aria-label": label }}
              value={typeof value === "string" ? value : ""}
              onChange={(v) => onChange(v)}
              options={options}
              disabled={isDisabled}
              {...(column.optionTones !== undefined && { tones: column.optionTones })}
              {...(touch && { size: "touch" as const })}
            />
          </div>
        );
      }
      return (
        <div data-cell-id={cellId} className="w-full min-w-0">
          <ComboboxInput
            id={cellId}
            name={cellId}
            ariaLabel={label}
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
        <div data-cell-id={cellId} className="w-full min-w-0">
          <ComboboxInput
            id={cellId}
            name={cellId}
            ariaLabel={label}
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
  readonly buttonSizeClass?: string;
};

export function RowActions({
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
  buttonSizeClass = "size-7",
}: RowActionsProps): ReactNode {
  const duplicateDisabled = maxItems !== undefined && rowsLength >= maxItems;
  const removeDisabled = rowsLength <= (minItems ?? 0);
  return (
    <div className="inline-flex items-center">
      <UiButton
        type="button"
        variant="ghost"
        size="icon"
        className={buttonSizeClass}
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
        className={buttonSizeClass}
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
        className={buttonSizeClass}
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
        className={buttonSizeClass}
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
