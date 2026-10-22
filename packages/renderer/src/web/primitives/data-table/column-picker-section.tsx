import { ArrowDown, ArrowUp, GripVertical } from "lucide-react";
import type { ReactNode } from "react";
import type { DataTableViewColumn } from "../../../data-table-view-types.ts";
import { useOptionalTranslation } from "../../../index.ts";
import { Button as UiButton } from "../../ui/button.tsx";
import { Checkbox } from "../../ui/checkbox.tsx";
import { usePointerDrag } from "../../widgets/use-pointer-drag.ts";

const ROW_HEIGHT_PX = 32;

function moveColumn(
  columns: readonly DataTableViewColumn[],
  from: number,
  to: number,
): readonly DataTableViewColumn[] {
  const target = Math.max(0, Math.min(columns.length - 1, to));
  if (target === from) return columns;
  const next = [...columns];
  const [moved] = next.splice(from, 1);
  if (moved !== undefined) next.splice(target, 0, moved);
  return next;
}

type PickerRowProps = {
  readonly columns: readonly DataTableViewColumn[];
  readonly index: number;
  readonly label: string;
  readonly isLastVisible: boolean;
  readonly onChange: (next: readonly DataTableViewColumn[]) => void;
};

function PickerRow({ columns, index, label, isLastVisible, onChange }: PickerRowProps): ReactNode {
  const translate = useOptionalTranslation();
  const column = columns[index];
  // Positions are relative to the order at pointer-down, so every move is idempotent.
  const drag = usePointerDrag({
    onStart: () => ({ snapshot: columns, from: index }),
    onMove: (start, { dy }) =>
      onChange(moveColumn(start.snapshot, start.from, start.from + Math.round(dy / ROW_HEIGHT_PX))),
  });
  if (column === undefined) return null;
  const checkboxId = `list-view-column-${column.field}`;
  return (
    <li
      className="flex h-8 items-center gap-1.5"
      data-testid={`list-view-column-row-${column.field}`}
    >
      <span
        {...drag}
        aria-hidden="true"
        className="flex size-6 shrink-0 cursor-grab touch-none items-center justify-center text-muted-foreground"
      >
        <GripVertical className="size-4" />
      </span>
      <Checkbox
        id={checkboxId}
        checked={column.visible}
        disabled={column.visible && isLastVisible}
        onCheckedChange={(checked: boolean | "indeterminate") =>
          onChange(columns.map((c, i) => (i === index ? { ...c, visible: checked === true } : c)))
        }
      />
      <label htmlFor={checkboxId} className="min-w-0 flex-1 truncate text-sm">
        {label}
      </label>
      <UiButton
        type="button"
        variant="ghost"
        size="icon"
        className="size-6"
        disabled={index === 0}
        aria-label={
          translate?.("kumiko.list.view.column.move-up", { column: label }) ?? `Move ${label} up`
        }
        onClick={() => onChange(moveColumn(columns, index, index - 1))}
      >
        <ArrowUp className="size-3.5" aria-hidden="true" />
      </UiButton>
      <UiButton
        type="button"
        variant="ghost"
        size="icon"
        className="size-6"
        disabled={index === columns.length - 1}
        aria-label={
          translate?.("kumiko.list.view.column.move-down", { column: label }) ??
          `Move ${label} down`
        }
        onClick={() => onChange(moveColumn(columns, index, index + 1))}
      >
        <ArrowDown className="size-3.5" aria-hidden="true" />
      </UiButton>
    </li>
  );
}

export function ColumnPickerSection({
  columns,
  labels,
  onChange,
}: {
  readonly columns: readonly DataTableViewColumn[];
  readonly labels: ReadonlyMap<string, string>;
  readonly onChange: (next: readonly DataTableViewColumn[]) => void;
}): ReactNode {
  const visibleCount = columns.filter((column) => column.visible).length;
  return (
    <ul className="m-0 flex list-none flex-col p-0" data-testid="list-view-columns">
      {columns.map((column, index) => (
        <PickerRow
          key={column.field}
          columns={columns}
          index={index}
          label={labels.get(column.field) ?? column.field}
          isLastVisible={visibleCount === 1}
          onChange={onChange}
        />
      ))}
    </ul>
  );
}
