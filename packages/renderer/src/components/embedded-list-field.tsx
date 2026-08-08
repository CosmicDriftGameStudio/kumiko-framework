import type {
  EditFieldViewModel,
  EmbeddedListCellViewModel,
  FieldIssue,
} from "@cosmicdrift/kumiko-headless";
import {
  computeDerivedCellValue,
  groupEmbeddedListIssues,
  roundDerivedCellValue,
  sumEmbeddedListColumn,
} from "@cosmicdrift/kumiko-headless";
import type { ReactNode } from "react";
import { toKebab } from "../app/qn";
import { REFERENCE_COMBOBOX_LIMIT } from "../hooks/reference-limits";
import { useQuery } from "../hooks/use-query";
import { useTranslation } from "../i18n";
import type { EmbeddedListColumn, EmbeddedListTotal } from "../primitives";
import { usePrimitives } from "../primitives";

export type EmbeddedListFieldProps = {
  readonly field: EditFieldViewModel;
  readonly id: string;
  readonly onChange: (value: unknown) => void;
  readonly allIssues: Readonly<Record<string, readonly FieldIssue[]>>;
  readonly featureName: string;
};

type EmbeddedRow = Readonly<Record<string, unknown>>;

function withRecomputedDerived(
  row: EmbeddedRow,
  derived: EditFieldViewModel["embeddedListDerived"],
  cells: readonly EmbeddedListCellViewModel[],
): EmbeddedRow {
  if (derived === undefined) return row;
  const result: Record<string, unknown> = { ...row };
  for (const [derivedField, def] of Object.entries(derived)) {
    const values = def.from.map((src) => {
      const v = result[src];
      return typeof v === "number" ? v : undefined;
    });
    const computed = computeDerivedCellValue(def.op, values);
    const target = cells.find((c) => c.field === derivedField);
    result[derivedField] =
      computed !== undefined && target !== undefined
        ? roundDerivedCellValue(computed, target)
        : computed;
  }
  return result;
}

function coerceCellValue(column: EmbeddedListColumn, text: string): unknown {
  switch (column.type) {
    case "text":
      return text;
    case "number":
    case "decimal": {
      if (text.trim() === "") return undefined;
      const n = Number(text);
      return Number.isFinite(n) ? n : undefined;
    }
    case "money": {
      // Money cells are minor-unit integers (cents) in storage — paste
      // arrives as a major-unit decimal string ("12,99"/"12.99"), so ×100.
      if (text.trim() === "") return undefined;
      const n = Number(text.replace(",", "."));
      return Number.isFinite(n) ? Math.round(n * 100) : undefined;
    }
    case "boolean":
      return ["true", "1", "yes", "y", "ja"].includes(text.trim().toLowerCase());
    case "date":
    case "timestamp":
      return text.trim();
    case "select": {
      const match = (column.options ?? []).find(
        (opt) => opt === text || column.optionLabels?.[opt] === text,
      );
      return match;
    }
    case "reference": {
      const match = (column.referenceOptions ?? []).find(
        (o) => o.label === text || o.value === text,
      );
      return match?.value;
    }
    default: {
      const exhaustiveCheck: never = column.type;
      return exhaustiveCheck;
    }
  }
}

export function EmbeddedListField({
  field,
  id,
  onChange,
  allIssues,
  featureName,
}: EmbeddedListFieldProps): ReactNode {
  const { EmbeddedListInput } = usePrimitives();
  const t = useTranslation();

  const cells = field.embeddedListCells ?? [];
  const rows = Array.isArray(field.value) ? (field.value as readonly EmbeddedRow[]) : [];
  const derived = field.embeddedListDerived;

  const referenceCells = cells.filter((c) => c.type === "reference");
  const referenceQueries = referenceCells.map((cell) => {
    const refFeature = cell.refFeature ?? featureName;
    const refEntity = cell.refEntity ?? "";
    const qn = `${toKebab(refFeature)}:query:${toKebab(refEntity)}:list`;
    // biome-ignore lint/correctness/useHookAtTopLevel: referenceCells comes from the entity-schema definition — fixed for the screen's lifetime, not a real conditional-hook risk.
    return useQuery<{ rows: ReadonlyArray<Record<string, unknown>> }>(qn, {
      limit: REFERENCE_COMBOBOX_LIMIT,
    });
  });

  if (EmbeddedListInput === undefined) return null;

  const columns: EmbeddedListColumn[] = cells.map((cell) => {
    const isDerived = derived?.[cell.field] !== undefined;
    if (cell.type === "reference") {
      const idx = referenceCells.indexOf(cell);
      const query = referenceQueries[idx];
      const labelField = cell.refLabelField ?? "id";
      const referenceOptions = (query?.data?.rows ?? []).map((row) => ({
        value: String(row["id"] ?? ""),
        label: String(row[labelField] ?? row["id"] ?? ""),
      }));
      return {
        field: cell.field,
        label: cell.label,
        type: cell.type,
        required: cell.required,
        derived: isDerived,
        referenceOptions,
        referenceLoading: query?.loading ?? false,
      };
    }
    return {
      field: cell.field,
      label: cell.label,
      type: cell.type,
      required: cell.required,
      derived: isDerived,
      ...(cell.options !== undefined && { options: cell.options }),
      ...(cell.optionLabels !== undefined && { optionLabels: cell.optionLabels }),
    };
  });

  const totals: EmbeddedListTotal[] = (field.embeddedListTotals ?? []).map((subFieldName) => {
    const cell = cells.find((c) => c.field === subFieldName);
    return {
      field: subFieldName,
      label: cell?.label ?? subFieldName,
      value: sumEmbeddedListColumn(rows, subFieldName),
    };
  });

  const { listIssues, rowIssues, cellIssues } = groupEmbeddedListIssues(allIssues, field.field);

  function replaceRow(rowIndex: number, updater: (row: EmbeddedRow) => EmbeddedRow): void {
    const nextRows = rows.map((row, i) => (i === rowIndex ? updater(row) : row));
    onChange(nextRows);
  }

  function handleCellChange(rowIndex: number, cellField: string, value: unknown): void {
    replaceRow(rowIndex, (row) =>
      withRecomputedDerived({ ...row, [cellField]: value }, derived, cells),
    );
  }

  function handleAddRow(): void {
    onChange([...rows, withRecomputedDerived({}, derived, cells)]);
  }

  function handleRemoveRow(rowIndex: number): void {
    onChange(rows.filter((_, i) => i !== rowIndex));
  }

  function handleDuplicateRow(rowIndex: number): void {
    const source = rows[rowIndex];
    if (source === undefined) return;
    const next = [...rows];
    next.splice(rowIndex + 1, 0, { ...source });
    onChange(next);
  }

  function handleMoveRow(fromIndex: number, toIndex: number): void {
    if (toIndex < 0 || toIndex >= rows.length) return;
    const next = [...rows];
    const [moved] = next.splice(fromIndex, 1);
    if (moved === undefined) return;
    next.splice(toIndex, 0, moved);
    onChange(next);
  }

  function handlePasteCells(
    rowIndex: number,
    columnIndex: number,
    grid: readonly (readonly string[])[],
  ): void {
    const maxItems = field.embeddedListMaxItems;
    const nextRows = [...rows];
    const touchedIndices = new Set<number>();

    grid.forEach((gridRow, gridRowOffset) => {
      const targetRowIndex = rowIndex + gridRowOffset;
      if (targetRowIndex >= nextRows.length) {
        if (maxItems !== undefined && nextRows.length >= maxItems) return;
        nextRows.push({});
      }
      const targetRow = nextRows[targetRowIndex];
      if (targetRow === undefined) return;
      let updatedRow: Record<string, unknown> = { ...targetRow };
      gridRow.forEach((text, gridColOffset) => {
        const column = columns[columnIndex + gridColOffset];
        if (column === undefined) return;
        updatedRow = { ...updatedRow, [column.field]: coerceCellValue(column, text) };
      });
      nextRows[targetRowIndex] = updatedRow;
      touchedIndices.add(targetRowIndex);
    });

    const recomputed = nextRows.map((row, i) =>
      touchedIndices.has(i) ? withRecomputedDerived(row, derived, cells) : row,
    );
    onChange(recomputed);
  }

  return (
    <EmbeddedListInput
      id={id}
      columns={columns}
      rows={rows}
      totals={totals}
      currency={field.embeddedListCurrency}
      disabled={field.readOnly}
      minItems={field.embeddedListMinItems}
      maxItems={field.embeddedListMaxItems}
      listIssues={listIssues}
      rowIssues={rowIssues}
      cellIssues={cellIssues}
      onCellChange={handleCellChange}
      onAddRow={handleAddRow}
      onRemoveRow={handleRemoveRow}
      onDuplicateRow={handleDuplicateRow}
      onMoveRow={handleMoveRow}
      onPasteCells={handlePasteCells}
      addLabel={t("kumiko.field.embedded-list.add-row")}
      removeLabel={t("kumiko.field.embedded-list.remove-row")}
      duplicateLabel={t("kumiko.field.embedded-list.duplicate-row")}
      moveUpLabel={t("kumiko.field.embedded-list.move-up")}
      moveDownLabel={t("kumiko.field.embedded-list.move-down")}
      emptyLabel={t("kumiko.field.embedded-list.empty")}
      emptyCtaLabel={t("kumiko.field.embedded-list.empty-cta")}
      testId={id}
    />
  );
}
