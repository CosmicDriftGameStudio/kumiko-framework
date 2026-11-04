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
    ...(hint.detailField !== undefined && { detailField: hint.detailField }),
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
    };
  });
}

// The hint cell owns its rendering: DataTableCell ignores the column's renderer and links once a hint is set.
export function withHintColumns(
  columns: readonly ListColumnViewModel[],
  screen: EntityListScreenDefinition,
  translate: Translate,
): readonly ListColumnViewModel[] {
  const hints = new Map<string, NonNullable<ReturnType<typeof normalizeListColumn>["hint"]>>();
  for (const spec of screen.columns) {
    const normalized = normalizeListColumn(spec);
    if (normalized.hint !== undefined) hints.set(normalized.field, normalized.hint);
  }
  if (hints.size === 0) return columns;
  return columns.map((col) => {
    const hint = hints.get(col.field);
    if (hint === undefined) return col;
    return { ...col, hint: hintViewModel(hint, screen.rowToneField, translate) };
  });
}
