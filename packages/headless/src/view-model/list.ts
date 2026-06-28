import type {
  EntityDefinition,
  EntityListScreenDefinition,
  FieldDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import { normalizeListColumn, parseRefTarget } from "@cosmicdrift/kumiko-framework/ui-types";
import type { ListColumnViewModel, ListRowViewModel, ListViewModel, Translate } from "./types";

export type ComputeListViewModelInput = {
  readonly screen: EntityListScreenDefinition;
  readonly entity: EntityDefinition;
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
  const { screen, entity, rows, translate, featureName } = input;

  const columns: ListColumnViewModel[] = [];
  for (const spec of screen.columns) {
    const normalized = normalizeListColumn(spec);
    const fieldDef = entity.fields[normalized.field];
    if (!fieldDef) {
      // Not a stored field — may be a read-time derived field (value appended
      // by the list-query handler). Render it as its display valueType; derived
      // columns carry no reference/select metadata and never server-sort.
      const derivedDef = entity.derivedFields?.[normalized.field];
      if (!derivedDef) {
        // Screen references a field that's neither stored nor derived. Fail
        // loud — the boot-validator (r.screen) should catch this, but a stale
        // field-rename would leave the screen referring to a ghost column
        // until ops re-runs boot. We throw so the renderer sees the error
        // instead of drawing an empty column.
        throw new Error(
          `computeListViewModel: screen "${screen.id}" references unknown field "${normalized.field}" on entity "${screen.entity}"`,
        );
      }
      columns.push({
        field: normalized.field,
        label: translate(fieldLabelKey(featureName, screen.entity, normalized.field)),
        type: derivedDef.valueType,
        // Display-only: a header sort would round-trip to the server, which has
        // no column to sort by (see DerivedFieldDef). Never offer the affordance.
        sortable: false,
        ...(normalized.renderer !== undefined && { renderer: normalized.renderer }),
      });
      continue;
    }
    const label = translate(fieldLabelKey(featureName, screen.entity, normalized.field));
    // Tier 2.7e-3 + Cross-Feature: Reference-Field — entity-String
    // kann same-feature ("user") oder cross-feature ("users:user")
    // sein. parseRefTarget gibt (featureName, entityName), der
    // Renderer baut die Lookup-QN als
    // `<refFeature>:query:<refEntity>:list`.
    const refRaw =
      fieldDef.type === "reference"
        ? (fieldDef as unknown as { entity?: string }).entity
        : undefined;
    const refTarget = refRaw !== undefined ? parseRefTarget(refRaw, featureName) : undefined;
    const refEntity = refTarget?.entityName;
    const refFeature = refTarget?.featureName;
    const refLabelField =
      fieldDef.type === "reference"
        ? ((fieldDef as unknown as { labelField?: string }).labelField ?? "id")
        : undefined;
    // Bei select-Feldern: translated Option-Labels einbacken. Convention
    // matcht den Form-Path → eine Translation-Quelle für List + Form.
    // Missing-Key returnt convention-gemäß den Key zurück; Renderer hat
    // dann humanizeSlug-Fallback.
    const optionLabels =
      fieldDef.type === "select"
        ? buildOptionLabels(
            translate,
            featureName,
            screen.entity,
            normalized.field,
            (fieldDef as unknown as { options?: readonly string[] }).options ?? [],
          )
        : undefined;
    const column: ListColumnViewModel = {
      field: normalized.field,
      label,
      type: fieldDef.type,
      sortable: fieldIsSortable(fieldDef),
      ...(normalized.renderer !== undefined && { renderer: normalized.renderer }),
      ...(optionLabels !== undefined && { optionLabels }),
      ...(refEntity !== undefined && { refEntity }),
      ...(refFeature !== undefined && { refFeature }),
      ...(refLabelField !== undefined && { refLabelField }),
    };
    columns.push(column);
  }

  const listRows: ListRowViewModel[] = rows.map((row) => ({
    id: String(row["id"] ?? ""),
    values: row,
  }));

  return {
    screenId: screen.id,
    entityName: screen.entity,
    columns,
    rows: listRows,
    ...(screen.slots && { slots: screen.slots }),
    isEmpty: listRows.length === 0,
  };
}

// Field-i18n-key convention matches what features register translations
// under (see packages/framework/src/i18n/ for the pattern). Duplicated
// here as a plain function — the ui-core boundary forbids depending on
// the i18n module directly.
export function fieldLabelKey(featureName: string, entityName: string, fieldName: string): string {
  return `${featureName}:entity:${entityName}:field:${fieldName}`;
}

export function fieldOptionLabelKey(
  featureName: string,
  entityName: string,
  fieldName: string,
  value: string,
): string {
  return `${featureName}:entity:${entityName}:field:${fieldName}:option:${value}`;
}

// Build a value→label map for a select-field's options. Convention:
// translate() returns the input key when the lookup misses (i18next
// default + LocaleResolver convention) — we surface the *raw value* in
// that case so the renderer's humanizeSlug fallback can take over.
// Without that fallback, an unlabeled option would render as the full
// `feature:entity:field:option:value`-key.
//
// Shared between list-VM and edit-VM so both builders produce
// identical option-translations.
export function buildOptionLabels(
  translate: (key: string, params?: Readonly<Record<string, unknown>>) => string,
  featureName: string,
  entityName: string,
  fieldName: string,
  options: readonly string[],
): Readonly<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const value of options) {
    const key = fieldOptionLabelKey(featureName, entityName, fieldName, value);
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
  const flag = (field as unknown as { sortable?: boolean }).sortable;
  return flag === true;
}
