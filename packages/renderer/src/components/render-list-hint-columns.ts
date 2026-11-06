import type {
  EntityListScreenDefinition,
  ListColumnHint,
} from "@cosmicdrift/kumiko-framework/ui-types";
import { normalizeListColumn } from "@cosmicdrift/kumiko-framework/ui-types";
import type { ListColumnHintViewModel, ListColumnViewModel, Translate } from "../headless/index.ts";

const HINT_EMPTY_LABEL_KEY = "kumiko.list.hint.empty";
const HINT_REASON_LABEL_KEY = "kumiko.list.hint.reason";

/** The hint's tone falls back to the list's `rowToneField`. */
export function hintViewModel(
  hint: ListColumnHint,
  rowToneField: string | undefined,
  translate: Translate,
): ListColumnHintViewModel {
  const toneField = hint.toneField ?? rowToneField;
  return {
    emptyLabel: translate(hint.emptyLabel ?? HINT_EMPTY_LABEL_KEY),
    reasonLabel: translate(HINT_REASON_LABEL_KEY),
    ...(hint.reasonField !== undefined && { reasonField: hint.reasonField }),
    ...(hint.reasonOpenField !== undefined && { reasonOpenField: hint.reasonOpenField }),
    ...(hint.reasonTitleField !== undefined && { reasonTitleField: hint.reasonTitleField }),
    ...(hint.detailField !== undefined && { detailField: hint.detailField }),
    ...(hint.narrowDetailField !== undefined && { narrowDetailField: hint.narrowDetailField }),
    ...(hint.narrowField !== undefined && { narrowField: hint.narrowField }),
    ...(hint.plainSentence === true && { plainSentence: true }),
    ...(toneField !== undefined && { toneField }),
  };
}

// Only "badge" is drawn by list tables; "button" is boot-rejected there (a row button is a rowAction) and "bar"/"datetime" are dashboard-only.
export function withDisplayColumns(
  columns: readonly ListColumnViewModel[],
  screen: EntityListScreenDefinition,
): readonly ListColumnViewModel[] {
  const specs = new Map(
    screen.columns.map((spec) => [normalizeListColumn(spec).field, normalizeListColumn(spec)]),
  );
  return columns.map((col) => {
    const spec = specs.get(col.field);
    if (spec?.display !== "badge") return col;
    return {
      ...col,
      display: spec.display,
      ...(spec.badgeToneField !== undefined && { badgeToneField: spec.badgeToneField }),
      ...(spec.badgeDot !== undefined && { badgeDot: spec.badgeDot }),
    };
  });
}

export function withEmptyPlaceholderColumns(
  columns: readonly ListColumnViewModel[],
  screen: EntityListScreenDefinition,
): readonly ListColumnViewModel[] {
  const blank = new Set(
    screen.columns.flatMap((spec) => {
      const column = normalizeListColumn(spec);
      return column.emptyPlaceholder === false ? [column.field] : [];
    }),
  );
  if (blank.size === 0) return columns;
  return columns.map((col) => (blank.has(col.field) ? { ...col, emptyPlaceholder: false } : col));
}

export function withNarrowOnlyColumns(
  columns: readonly ListColumnViewModel[],
  screen: EntityListScreenDefinition,
): readonly ListColumnViewModel[] {
  const narrowOnly = new Set(
    screen.columns.flatMap((spec) => {
      const column = normalizeListColumn(spec);
      return column.showOnNarrowOnly === true ? [column.field] : [];
    }),
  );
  if (narrowOnly.size === 0) return columns;
  return columns.map((col) =>
    narrowOnly.has(col.field) ? { ...col, showOnNarrowOnly: true } : col,
  );
}

export function withNarrowInlineColumns(
  columns: readonly ListColumnViewModel[],
  screen: EntityListScreenDefinition,
): readonly ListColumnViewModel[] {
  const inline = new Set(
    screen.columns.flatMap((spec) => {
      const column = normalizeListColumn(spec);
      return column.narrowInline === true ? [column.field] : [];
    }),
  );
  if (inline.size === 0) return columns;
  return columns.map((col) => (inline.has(col.field) ? { ...col, narrowInline: true } : col));
}

// The hint cell owns its rendering: DataTableCell ignores the column's renderer and links once a hint is set.
export function withHintColumns(
  columns: readonly ListColumnViewModel[],
  screen: EntityListScreenDefinition,
  translate: Translate,
): readonly ListColumnViewModel[] {
  const hints = new Map<string, NonNullable<ReturnType<typeof normalizeListColumn>["hint"]>>();
  const normalized = new Map<string, ReturnType<typeof normalizeListColumn>>();
  for (const spec of screen.columns) {
    const column = normalizeListColumn(spec);
    if (column.hint === undefined) continue;
    hints.set(column.field, column.hint);
    normalized.set(column.field, column);
  }
  if (hints.size === 0) return columns;
  return columns.map((col) => {
    const hint = hints.get(col.field);
    if (hint === undefined) return col;
    const { width, minWidth } = normalized.get(col.field) ?? {};
    return {
      ...col,
      hint: hintViewModel(hint, screen.rowToneField, translate),
      ...(width !== undefined && { width }),
      ...(minWidth !== undefined && { minWidth }),
    };
  });
}
