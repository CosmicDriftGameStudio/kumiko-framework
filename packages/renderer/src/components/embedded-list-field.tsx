import { evalFieldCondition, isFieldRequired } from "@cosmicdrift/kumiko-framework/ui-types";
import { isPlainObject } from "@cosmicdrift/kumiko-types/type-guards";
import { type ReactNode, useState } from "react";
import type {
  EditFieldViewModel,
  EmbeddedListCellViewModel,
  FieldIssue,
} from "../headless/index.ts";
import {
  groupEmbeddedListIssues,
  sumEmbeddedListColumn,
  withDerivedCells,
} from "../headless/index.ts";
import { pluralKey } from "../headless/plural-key.ts";
import { REFERENCE_COMBOBOX_LIMIT } from "../hooks/reference-limits.ts";
import { useQuery } from "../hooks/use-query.ts";
import {
  referenceOptionSource,
  storedReferenceRowsPayload,
  withUnlistedSelectedRows,
} from "../hooks/use-reference-lookup.ts";
import { useTranslation } from "../i18n.tsx";
import type { EmbeddedListColumn, EmbeddedListTotal } from "../primitives.tsx";
import { usePrimitives } from "../primitives.tsx";
import { coerceCellValue } from "./embedded-list-paste.ts";

export type EmbeddedListFieldProps = {
  readonly field: EditFieldViewModel;
  readonly id: string;
  readonly onChange: (value: unknown) => void;
  readonly allIssues: Readonly<Record<string, readonly FieldIssue[]>>;
  readonly featureName: string;
};

type EmbeddedRow = Readonly<Record<string, unknown>>;

type RowStateCallbacks = Pick<
  EmbeddedListColumn,
  "isHiddenInRow" | "isRequiredInRow" | "isDerivedInRow"
>;

// The primitive never imports condition logic, so the per-row state is evaluated here.
function rowStateCallbacks(
  cell: EmbeddedListCellViewModel,
  derivedDef: NonNullable<EditFieldViewModel["embeddedListDerived"]>[string] | undefined,
): RowStateCallbacks {
  const { visibleWhen, requiredWhen } = cell;
  const derivedWhen = derivedDef?.when;
  return {
    ...(visibleWhen !== undefined && {
      isHiddenInRow: (row) => !evalFieldCondition(visibleWhen, row),
    }),
    ...((visibleWhen !== undefined || requiredWhen !== undefined) && {
      isRequiredInRow: (row) =>
        isFieldRequired({ required: cell.required, visibleWhen, requiredWhen }, row),
    }),
    ...(derivedDef !== undefined &&
      derivedWhen !== undefined && {
        isDerivedInRow: (row) => evalFieldCondition(derivedWhen, row),
      }),
  };
}

type CardPlacement = Pick<EmbeddedListColumn, "cardLimits" | "cardAttachedTo"> & {
  readonly hiddenInCard?: boolean;
};

// An inRange derived cell (value, min, max → result) reads as one measurement on a phone card:
// the limits become a hint under the value and the result sits beside it. Editable limits stay
// their own rows: hiding them would leave phone users no way to fill them.
function cardPlacementByField(
  derived: EditFieldViewModel["embeddedListDerived"],
  cells: readonly EmbeddedListCellViewModel[],
): ReadonlyMap<string, CardPlacement> {
  const placement = new Map<string, CardPlacement>();
  const isNotEditable = (field: string): boolean => {
    const cell = cells.find((c) => c.field === field);
    return cell !== undefined && (cell.readOnly === true || derived?.[field] !== undefined);
  };
  for (const [target, def] of Object.entries(derived ?? {})) {
    if (def.op !== "inRange") continue;
    const [value, min, max] = def.from;
    if (value === undefined || min === undefined || max === undefined) continue;
    if (isNotEditable(min) && isNotEditable(max)) {
      placement.set(value, { cardLimits: { min, max } });
      placement.set(min, { hiddenInCard: true });
      placement.set(max, { hiddenInCard: true });
    }
    placement.set(target, { cardAttachedTo: value });
  }
  return placement;
}

function cardColumnProps(
  cell: EmbeddedListCellViewModel,
  placement: ReadonlyMap<string, CardPlacement>,
): CardPlacement {
  const fromDerived = placement.get(cell.field);
  return {
    ...fromDerived,
    ...((cell.hiddenInCard === true || fromDerived?.hiddenInCard === true) && {
      hiddenInCard: true,
    }),
  };
}

function storedCellIds(rows: readonly EmbeddedRow[], cellField: string): string[] {
  const ids = new Set<string>();
  for (const row of rows) {
    const value = row[cellField];
    if (typeof value === "string" && value !== "") ids.add(value);
  }
  return [...ids].sort();
}

function withRecomputedDerived(
  row: EmbeddedRow,
  derived: EditFieldViewModel["embeddedListDerived"],
  cells: readonly EmbeddedListCellViewModel[],
): EmbeddedRow {
  if (derived === undefined) return row;
  const targets = Object.fromEntries(cells.map((cell) => [cell.field, cell]));
  const recomputed = withDerivedCells(row, derived, targets);
  return isPlainObject(recomputed) ? recomputed : row;
}

// The reference-column queries are hooks called in a loop, so their count must
// stay fixed per mount. Keying on the reference cells remounts when that set
// changes (field-level access, in-place entity swap) instead of breaking hook order.
export function EmbeddedListField(props: EmbeddedListFieldProps): ReactNode {
  const referenceKey = (props.field.embeddedListCells ?? [])
    .filter((c) => c.type === "reference")
    .map((c) => `${c.field}:${c.refFeature ?? ""}:${c.refEntity ?? ""}`)
    .join("|");
  return <EmbeddedListFieldInner key={referenceKey} {...props} />;
}

function EmbeddedListFieldInner({
  field,
  id,
  onChange,
  allIssues,
  featureName,
}: EmbeddedListFieldProps): ReactNode {
  const { EmbeddedListInput } = usePrimitives();
  const t = useTranslation();
  const [pasteWarning, setPasteWarning] = useState<{
    readonly droppedRows: number;
    readonly unmatchedCells: number;
  } | null>(null);

  const cells = field.embeddedListCells ?? [];
  const rows = Array.isArray(field.value) ? (field.value as readonly EmbeddedRow[]) : [];
  const derived = field.embeddedListDerived;

  const referenceCells = cells.filter((c) => c.type === "reference");
  const referenceSources = referenceCells.map((cell) =>
    referenceOptionSource(cell, cell.refFeature ?? featureName, cell.refEntity ?? ""),
  );
  const referenceQueries = referenceSources.map((source) =>
    // biome-ignore lint/correctness/useHookAtTopLevel: the wrapper keys this component on the reference-cell set, so the hook count is fixed per mount.
    useQuery<{ rows: ReadonlyArray<Record<string, unknown>> }>(source.queryQn, {
      limit: REFERENCE_COMBOBOX_LIMIT,
    }),
  );
  // The first options page can miss a stored value; without its row the cell shows no label.
  const storedReferenceQueries = referenceCells.map((cell, idx) => {
    const storedIds = storedCellIds(rows, cell.field);
    // biome-ignore lint/correctness/useHookAtTopLevel: same fixed per-mount hook count as referenceQueries above.
    return useQuery<{ rows: ReadonlyArray<Record<string, unknown>> }>(
      referenceSources[idx]?.queryQn ?? "",
      storedReferenceRowsPayload(cell, storedIds, REFERENCE_COMBOBOX_LIMIT),
      { enabled: storedIds.length > 0 },
    );
  });

  if (EmbeddedListInput === undefined) return null;

  const cardPlacement = cardPlacementByField(derived, cells);

  const columns: EmbeddedListColumn[] = cells.map((cell) => {
    const isDerived = derived?.[cell.field] !== undefined;
    if (cell.type === "reference") {
      const idx = referenceCells.indexOf(cell);
      const query = referenceQueries[idx];
      const labelKey = referenceSources[idx]?.labelKey ?? "id";
      const referenceOptions = withUnlistedSelectedRows(
        query?.data?.rows ?? [],
        storedReferenceQueries[idx]?.data?.rows ?? [],
      ).map((row) => ({
        value: String(row["id"] ?? ""),
        label: String(row[labelKey] ?? row["id"] ?? ""),
      }));
      return {
        field: cell.field,
        label: cell.label,
        type: cell.type,
        required: cell.required,
        derived: isDerived,
        ...rowStateCallbacks(cell, derived?.[cell.field]),
        ...(cell.readOnly === true && { readOnly: true }),
        ...cardColumnProps(cell, cardPlacement),
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
      ...rowStateCallbacks(cell, derived?.[cell.field]),
      ...(cell.readOnly === true && { readOnly: true }),
      ...cardColumnProps(cell, cardPlacement),
      ...(cell.options !== undefined && { options: cell.options }),
      ...(cell.optionLabels !== undefined && { optionLabels: cell.optionLabels }),
      ...(cell.display !== undefined && { display: cell.display }),
      ...(cell.optionTones !== undefined && { optionTones: cell.optionTones }),
      ...(cell.capture !== undefined && { capture: cell.capture }),
      ...(cell.maxCount !== undefined && { maxCount: cell.maxCount }),
      ...(cell.accept !== undefined && { accept: cell.accept }),
    };
  });

  const totals: EmbeddedListTotal[] = (field.embeddedListTotals ?? []).map((entry) => {
    if (typeof entry === "string") {
      const cell = cells.find((c) => c.field === entry);
      return {
        field: entry,
        label: cell?.label ?? entry,
        value: sumEmbeddedListColumn(rows, entry),
      };
    }
    return {
      field: `${entry.from.join("+")}:${entry.label}`,
      label: t(entry.label),
      value: entry.from.reduce((sum, name) => sum + sumEmbeddedListColumn(rows, name), 0),
      money: entry.from.every((name) => cells.find((c) => c.field === name)?.type === "money"),
    };
  });

  const { listIssues, rowIssues, cellIssues } = groupEmbeddedListIssues(allIssues, field.field);
  const combinedListIssues: readonly FieldIssue[] =
    pasteWarning === null
      ? listIssues
      : [
          ...listIssues,
          ...(pasteWarning.droppedRows > 0
            ? [
                {
                  path: field.field,
                  code: "paste-rows-truncated",
                  i18nKey: pluralKey(
                    "kumiko.field.embedded-list.paste-rows-truncated",
                    pasteWarning.droppedRows,
                  ),
                  params: { count: pasteWarning.droppedRows },
                },
              ]
            : []),
          ...(pasteWarning.unmatchedCells > 0
            ? [
                {
                  path: field.field,
                  code: "paste-cells-unmatched",
                  i18nKey: pluralKey(
                    "kumiko.field.embedded-list.paste-cells-unmatched",
                    pasteWarning.unmatchedCells,
                  ),
                  params: { count: pasteWarning.unmatchedCells },
                },
              ]
            : []),
        ];

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
    const fixedRows = field.embeddedListFixedRows === true;
    const nextRows = [...rows];
    const touchedIndices = new Set<number>();
    let droppedRows = 0;
    let unmatchedCells = 0;

    grid.forEach((gridRow, gridRowOffset) => {
      const targetRowIndex = rowIndex + gridRowOffset;
      if (targetRowIndex >= nextRows.length) {
        if (fixedRows || (maxItems !== undefined && nextRows.length >= maxItems)) {
          droppedRows += 1;
          return;
        }
        nextRows.push({});
      }
      const targetRow = nextRows[targetRowIndex];
      if (targetRow === undefined) return;
      let updatedRow: Record<string, unknown> = { ...targetRow };
      gridRow.forEach((text, gridColOffset) => {
        const column = columns[columnIndex + gridColOffset];
        if (column === undefined || column.readOnly === true) return;
        if (column.type === "images" || column.type === "files") return;
        const coerced = coerceCellValue(column, text, field.embeddedListCurrency ?? "EUR");
        // Also covers an unparseable money paste (e.g. mangled thousands
        // separators) — the cell must stay unchanged instead of silently
        // clearing to undefined.
        const isUnmatchedOrUnparseable =
          (column.type === "select" || column.type === "reference" || column.type === "money") &&
          coerced === undefined &&
          text.trim() !== "";
        if (isUnmatchedOrUnparseable) {
          unmatchedCells += 1;
          return;
        }
        updatedRow = { ...updatedRow, [column.field]: coerced };
      });
      nextRows[targetRowIndex] = updatedRow;
      touchedIndices.add(targetRowIndex);
    });

    setPasteWarning(droppedRows > 0 || unmatchedCells > 0 ? { droppedRows, unmatchedCells } : null);

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
      fixedRows={field.embeddedListFixedRows}
      minItems={field.embeddedListMinItems}
      maxItems={field.embeddedListMaxItems}
      uploadTarget={field.embeddedListUploadTarget}
      listIssues={combinedListIssues}
      rowIssues={rowIssues}
      cellIssues={cellIssues}
      onCellChange={handleCellChange}
      onAddRow={handleAddRow}
      onRemoveRow={handleRemoveRow}
      onDuplicateRow={handleDuplicateRow}
      onMoveRow={handleMoveRow}
      onPasteCells={handlePasteCells}
      addLabel={t("kumiko.field.embedded-list.add-row")}
      actionsLabel={t("kumiko.field.embedded-list.actions")}
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
