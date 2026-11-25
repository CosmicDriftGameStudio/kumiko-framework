import type { EntityDefinition, ListColumnEdit } from "@cosmicdrift/kumiko-framework/ui-types";
import { evalFieldCondition, normalizeListColumn } from "@cosmicdrift/kumiko-framework/ui-types";
import { useMemo, useState } from "react";
import { type ErrorNotice, errorNoticeOf } from "../app/error-reference.tsx";
import { dispatcherErrorText, WriteFailedError } from "../app/write-failed-error.ts";
import { useOptionalDispatcher } from "../context/dispatcher-context.tsx";
import {
  type EditRelatedListSectionViewModel,
  EMPTY_VALUE_PLACEHOLDER,
  fieldLabelKey,
  fieldOptionLabelKey,
  type Translate,
} from "../headless/index.ts";
import type { DataTableProps } from "../primitives.tsx";

/** Cell editors of the columns that declare `edit`: a select where `when` holds, written through the column's handler. */
function buildCellEditor(args: {
  readonly columns: EditRelatedListSectionViewModel["columns"];
  readonly sourceEntity: EntityDefinition | undefined;
  readonly feature: string | undefined;
  readonly entityName: string | undefined;
  readonly translate: Translate;
  readonly write: (handler: string, payload: Record<string, unknown>) => Promise<void>;
}): DataTableProps["cellEditor"] {
  const edits = new Map<string, ListColumnEdit>();
  for (const column of args.columns) {
    const normalized = normalizeListColumn(column);
    if (normalized.edit !== undefined) edits.set(normalized.field, normalized.edit);
  }
  if (edits.size === 0) return undefined;
  return (row, field) => {
    const edit = edits.get(field);
    if (edit === undefined) return undefined;
    if (edit.when !== undefined && !evalFieldCondition(edit.when, { ...row.values }))
      return undefined;
    const editField = edit.field ?? field;
    const fieldDef = args.sourceEntity?.fields[editField];
    if (fieldDef?.type !== "select") return undefined;
    const { feature, entityName, translate } = args;
    const labelOf = (value: string): string => {
      if (feature === undefined || entityName === undefined) return value;
      const key = fieldOptionLabelKey(feature, entityName, editField, value);
      const translated = translate(key);
      return translated === key ? value : translated;
    };
    const current = row.values[editField];
    const labelKey =
      feature !== undefined && entityName !== undefined
        ? fieldLabelKey(feature, entityName, editField)
        : undefined;
    const translatedLabel = labelKey === undefined ? editField : translate(labelKey);
    return {
      options: fieldDef.options.map((value) => ({ value, label: labelOf(value) })),
      value: typeof current === "string" ? current : null,
      required: edit.required === true,
      placeholder: EMPTY_VALUE_PLACEHOLDER,
      ariaLabel: translatedLabel === labelKey ? editField : translatedLabel,
      onChange: (value) => {
        void args.write(edit.handler, { id: row.id, [editField]: value });
      },
    };
  };
}

/** The table's cell editor plus the notice of the last failed cell write. */
export function useRelatedListCellEditor(args: {
  readonly columns: EditRelatedListSectionViewModel["columns"];
  readonly sourceEntity: EntityDefinition | undefined;
  readonly feature: string | undefined;
  readonly entityName: string | undefined;
  readonly translate: Translate;
  readonly refetch: () => Promise<void>;
}): {
  readonly cellEditor: DataTableProps["cellEditor"];
  readonly cellEditError: ErrorNotice | null;
} {
  const { columns, sourceEntity, feature, entityName, translate, refetch } = args;
  const dispatcher = useOptionalDispatcher();
  const [cellEditError, setCellEditError] = useState<ErrorNotice | null>(null);
  const cellEditor = useMemo(
    () =>
      buildCellEditor({
        columns,
        sourceEntity,
        feature,
        entityName,
        translate,
        write: async (handler, payload) => {
          if (dispatcher === undefined) return;
          try {
            const result = await dispatcher.write(handler, payload);
            if (!result.isSuccess) {
              throw new WriteFailedError(
                result.error,
                dispatcherErrorText(result.error, translate),
              );
            }
            setCellEditError(null);
            await refetch();
          } catch (error) {
            setCellEditError(errorNoticeOf(error));
          }
        },
      }),
    [columns, sourceEntity, feature, entityName, translate, dispatcher, refetch],
  );
  return { cellEditor, cellEditError };
}
