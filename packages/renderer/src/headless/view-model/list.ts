import type {
  EntityDefinition,
  EntityListScreenDefinition,
  FieldDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import {
  LIST_ROW_META_COLUMNS,
  LIST_ROW_META_REFERENCES,
  normalizeListColumn,
  parseRefTarget,
} from "@cosmicdrift/kumiko-framework/ui-types";
import { deriveListFileDisplay } from "./list-file-display.ts";
import type { ListColumnViewModel, ListRowViewModel, ListViewModel, Translate } from "./types.ts";

const WRITE_ONLY_SET_LABEL_KEY = "kumiko.field.writeOnly.set";

export type ComputeListViewModelInput = {
  readonly screen: EntityListScreenDefinition;
  readonly entity: Pick<EntityDefinition, "fields" | "derivedFields">;
  readonly rows: readonly Readonly<Record<string, unknown>>[];
  // Translate callback — normally LocaleResolver.translate. Labels use the
  // i18n convention "{feature}:entity:{entityName}:field:{fieldName}"; if
  // the key is absent from the active bundle, i18next falls back to the
  // key itself, which is fine for dev.
  readonly translate: Translate;
  // Feature + entity name are required for i18n key composition —
  // ScreenDefinition carries `entity: string` but not the feature scope,
  // and i18n keys are prefixed by feature. Passed in by the caller (the
  // renderer knows its host-feature context).
  readonly featureName: string;
};

// Pure transform: takes the declared screen + entity + incoming rows, spits
// out the flat shape the renderer draws. No conditions, no access-checks —
// those are list-level decisions that the caller makes BEFORE calling
// here (e.g. filtering rows by ownership on the server / before query).
// Field-level read-access (Level 3 of UI-architecture.md §Permission) is a
// follow-up; this v1 assumes the caller passed a row-filter that drops any
// field the user may not see.
export function computeListViewModel(input: ComputeListViewModelInput): ListViewModel {
  const { screen, rows } = input;
  const columns = screen.columns.map((spec) => resolveListColumn(input, normalizeListColumn(spec)));
  const listRows: ListRowViewModel[] = rows.map(writeOnlyRowFormatter(input));
  return {
    screenId: screen.id,
    entityName: screen.entity,
    columns,
    rows: listRows,
    ...(screen.slots && { slots: screen.slots }),
    isEmpty: listRows.length === 0,
  };
}

type NormalizedListColumn = ReturnType<typeof normalizeListColumn>;
type ListColumnResolver = (
  input: ComputeListViewModelInput,
  column: NormalizedListColumn,
) => ListColumnViewModel | undefined;

// First match wins; the order encodes which metadata source a column name
// resolves against when several could claim it.
const LIST_COLUMN_RESOLVERS: readonly ListColumnResolver[] = [
  declaredReferenceColumn,
  storedFieldColumn,
  derivedFieldColumn,
  rowMetaColumn,
  virtualRendererColumn,
];

function resolveListColumn(
  input: ComputeListViewModelInput,
  column: NormalizedListColumn,
): ListColumnViewModel {
  for (const resolve of LIST_COLUMN_RESOLVERS) {
    const resolved = resolve(input, column);
    if (resolved) return resolved;
  }
  // No metadata source claims the name: an author typo or a stale field
  // rename, so fail loud instead of silently drawing nothing.
  throw new Error(
    `computeListViewModel: screen "${input.screen.id}" references unknown field "${column.field}" on entity "${input.screen.entity}"`,
  );
}

function translatedColumnLabel(
  input: ComputeListViewModelInput,
  column: NormalizedListColumn,
): string {
  return input.translate(
    column.label ?? fieldLabelKey(input.featureName, input.screen.entity, column.field),
  );
}

// A real non-text entity field keeps its own type (documented on
// ListColumnSpec.refEntity); only the all-"text" pseudo-entities of the
// projection shims and fields without a stored def take the declared path.
function declaredReferenceColumn(
  input: ComputeListViewModelInput,
  column: NormalizedListColumn,
): ListColumnViewModel | undefined {
  const storedFieldType = input.entity.fields[column.field]?.type;
  // skip: no declared reference, or a real non-text field that keeps its own type
  if (
    column.refEntity === undefined ||
    (storedFieldType !== undefined && storedFieldType !== "text")
  ) {
    return undefined;
  }
  // Declared reference metadata (ListColumnSpec.refEntity) — for
  // projectionList/relatedList columns, which have no EntityDefinition
  // field to carry a real "reference" type. Checked before the
  // entity.fields lookup so it also fires against the pseudo-entities
  // that hardcode every field as "text" (projection-list-shim,
  // related-list-section) — those never reach the stored reference branch
  // since fieldDef.type is always "text" there.
  const refTarget = parseRefTarget(column.refEntity, input.featureName);
  return {
    field: column.field,
    label: translatedColumnLabel(input, column),
    type: "reference",
    // The declared value is the referenced id, not the resolved label —
    // there is no column to server-sort by, same as row-meta references.
    sortable: false,
    refEntity: refTarget.entityName,
    refFeature: refTarget.featureName,
    refLabelField: column.refLabelField ?? "id",
    ...(column.renderer !== undefined && { renderer: column.renderer }),
    ...(column.hideOnNarrow === true && { hideOnNarrow: true }),
  };
}

function storedFieldColumn(
  input: ComputeListViewModelInput,
  column: NormalizedListColumn,
): ListColumnViewModel | undefined {
  const fieldDef = input.entity.fields[column.field];
  // skip: not a stored field, a later resolver decides
  if (!fieldDef) return undefined;
  return {
    field: column.field,
    label: translatedColumnLabel(input, column),
    type: fieldDef.type,
    sortable: fieldIsSortable(fieldDef),
    ...(column.renderer !== undefined && { renderer: column.renderer }),
    ...storedFieldMetadata(input, column, fieldDef),
    ...(column.hideOnNarrow === true && { hideOnNarrow: true }),
  };
}

// Key order is part of the serialized view model, so it stays fixed here.
function storedFieldMetadata(
  input: ComputeListViewModelInput,
  column: NormalizedListColumn,
  fieldDef: FieldDefinition,
): Partial<ListColumnViewModel> {
  // For select and multiSelect fields: bake in translated option labels.
  // Convention matches the form path → one translation source for list +
  // form. A missing key returns the key itself per convention; the
  // renderer then falls back to humanizeSlug.
  const optionLabels =
    fieldDef.type === "select" || fieldDef.type === "multiSelect"
      ? buildOptionLabels(
          input.translate,
          (value) =>
            fieldOptionLabelKey(input.featureName, input.screen.entity, column.field, value),
          fieldDef.options,
        )
      : undefined;
  const optionTones = fieldDef.type === "select" ? fieldDef.optionTones : undefined;
  const grouping = fieldDef.type === "number" ? fieldDef.grouping : undefined;
  const fileDisplay = deriveListFileDisplay(fieldDef, column.renderer);
  return {
    ...(optionLabels !== undefined && { optionLabels }),
    ...(optionTones !== undefined && { optionTones }),
    ...storedReferenceMetadata(fieldDef, input.featureName),
    ...(grouping !== undefined && { grouping }),
    ...(fileDisplay !== undefined && { fileDisplay }),
  };
}

// Reference fields may target the same feature ("user") or another feature
// ("users:user"). parseRefTarget returns the feature and entity names, which
// the renderer uses to build the lookup query as
// `<refFeature>:query:<refEntity>:list`.
function storedReferenceMetadata(
  fieldDef: FieldDefinition,
  featureName: string,
): Pick<ListColumnViewModel, "refEntity" | "refFeature" | "refLabelField"> {
  if (fieldDef.type !== "reference") return {};
  const refTarget = parseRefTarget(fieldDef.entity, featureName);
  return {
    refEntity: refTarget.entityName,
    refFeature: refTarget.featureName,
    refLabelField: fieldDef.labelField ?? "id",
  };
}

// Not a stored field — may be a read-time derived field (value appended
// by the list-query handler). Render it as its display valueType; derived
// columns carry no reference/select metadata and never server-sort.
function derivedFieldColumn(
  input: ComputeListViewModelInput,
  column: NormalizedListColumn,
): ListColumnViewModel | undefined {
  const derivedDef = input.entity.derivedFields?.[column.field];
  // skip: not a derived field, a later resolver decides
  if (!derivedDef) return undefined;
  return {
    field: column.field,
    label: translatedColumnLabel(input, column),
    type: derivedDef.valueType,
    // Display-only: a header sort would round-trip to the server, which has
    // no column to sort by (see DerivedFieldDef). Never offer the affordance.
    sortable: false,
    ...(column.renderer !== undefined && { renderer: column.renderer }),
    ...(column.hideOnNarrow === true && { hideOnNarrow: true }),
  };
}

// Row-meta column (id/tenantId/version/insertedAt/modifiedAt/...) —
// a real base-table column that's never a declared entity field, e.g.
// a SystemAdmin cross-tenant list exposing tenantId. Unlike derived
// fields, these are actual DB columns, so server-side ORDER BY works —
// sortable stays true, except for the ID columns in LIST_ROW_META_REFERENCES.
function rowMetaColumn(
  input: ComputeListViewModelInput,
  column: NormalizedListColumn,
): ListColumnViewModel | undefined {
  const rowMetaType = LIST_ROW_META_COLUMNS[column.field];
  // skip: not a base-table column, a later resolver decides
  if (rowMetaType === undefined) return undefined;
  const rowMetaRef = LIST_ROW_META_REFERENCES[column.field];
  return {
    field: column.field,
    label: translatedColumnLabel(input, column),
    type: rowMetaRef !== undefined ? "reference" : rowMetaType,
    // The DB column holds the GUID, not the resolved label — server-side
    // ORDER BY would sort by GUID while the cell shows the name.
    sortable: rowMetaRef === undefined,
    ...(column.renderer !== undefined && { renderer: column.renderer }),
    ...(column.hideOnNarrow === true && { hideOnNarrow: true }),
    ...(rowMetaRef !== undefined && {
      refEntity: rowMetaRef.refEntity,
      refFeature: rowMetaRef.refFeature,
      refLabelField: rowMetaRef.refLabelField,
    }),
  };
}

// A virtual presentational column — drawn entirely by a columnRenderer
// component from the row (e.g. tag chips); value is undefined and it
// never server-sorts. `field` is just the column key. It needs BOTH a
// label AND a renderer — renderer is what actually draws it; a label
// alone with no renderer would push an empty, unrendered column into
// the view model.
function virtualRendererColumn(
  input: ComputeListViewModelInput,
  column: NormalizedListColumn,
): ListColumnViewModel | undefined {
  // skip: without both a label and a renderer the column is unknown
  if (column.label === undefined || column.renderer === undefined) return undefined;
  return {
    field: column.field,
    label: input.translate(column.label),
    type: "text",
    sortable: false,
    renderer: column.renderer,
    ...(column.hideOnNarrow === true && { hideOnNarrow: true }),
  };
}

// The wire carries `true` (set) / `null` (empty) for writeOnly fields; the cell shows a word, not "true".
function writeOnlyRowFormatter(
  input: ComputeListViewModelInput,
): (row: Readonly<Record<string, unknown>>) => ListRowViewModel {
  const { screen, entity, translate } = input;
  const writeOnlyFieldNames = screen.columns
    .map((spec) => normalizeListColumn(spec).field)
    .filter((name) => {
      const fieldDef = entity.fields[name];
      return fieldDef?.type === "text" && fieldDef.writeOnly === true;
    });
  return (row) => {
    const shown: Record<string, unknown> = { ...row };
    for (const name of writeOnlyFieldNames) {
      if (row[name] === true) shown[name] = translate(WRITE_ONLY_SET_LABEL_KEY);
    }
    return { id: String(row["id"] ?? ""), values: shown };
  };
}

// Field-i18n-key convention matches what features register translations
// under (see packages/framework/src/i18n/ for the pattern). Duplicated
// here as a plain function — the ui-core boundary forbids depending on
// the i18n module directly.
export function fieldLabelKey(featureName: string, entityName: string, fieldName: string): string {
  return `${featureName}:entity:${entityName}:field:${fieldName}`;
}

export function fieldOptionLabelKeyPrefix(
  featureName: string,
  entityName: string,
  fieldName: string,
): string {
  return `${fieldLabelKey(featureName, entityName, fieldName)}:option:`;
}

export function fieldOptionLabelKey(
  featureName: string,
  entityName: string,
  fieldName: string,
  value: string,
): string {
  return `${fieldOptionLabelKeyPrefix(featureName, entityName, fieldName)}${value}`;
}

// Embedded-list cell label key — one level deeper than fieldLabelKey,
// keyed by the sub-field name inside an embedded-LIST field's `schema`
// (invoice-positions-style tables built via createEmbeddedListField()).
export function embeddedCellLabelKey(
  featureName: string,
  entityName: string,
  fieldName: string,
  subFieldName: string,
): string {
  return `${featureName}:entity:${entityName}:field:${fieldName}:cell:${subFieldName}`;
}

export function embeddedCellOptionLabelKey(
  featureName: string,
  entityName: string,
  fieldName: string,
  subFieldName: string,
  value: string,
): string {
  return `${featureName}:entity:${entityName}:field:${fieldName}:cell:${subFieldName}:option:${value}`;
}

// Build a value→label map for a select-field's options. Convention:
// translate() returns the input key when the lookup misses (i18next
// default + LocaleResolver convention) — we surface the *raw value* in
// that case so the renderer's humanizeSlug fallback can take over.
// Without that fallback, an unlabeled option would render as the full
// `feature:entity:field:option:value`-key.
//
// `keyFor` carries whichever key convention the caller needs (top-level
// field via fieldOptionLabelKey, embedded-list cell via
// embeddedCellOptionLabelKey) — shared between list-VM, edit-VM, and
// embedded-list cells so all three produce identical option-translations.
export function buildOptionLabels(
  translate: (key: string, params?: Readonly<Record<string, unknown>>) => string,
  keyFor: (value: string) => string,
  options: readonly string[],
): Readonly<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const value of options) {
    const key = keyFor(value);
    const translated = translate(key);
    out[value] = translated === key ? value : translated;
  }
  return out;
}

// A field can declare `sortable: true` on the FieldDefinition. This is
// framework-level metadata used both by the server's list-query builder
// (ORDER BY safety) and by the UI (column header click indicator). All
// field types can bear the flag; it's off by default.
function fieldIsSortable(field: FieldDefinition): boolean {
  return "sortable" in field && field.sortable === true;
}
