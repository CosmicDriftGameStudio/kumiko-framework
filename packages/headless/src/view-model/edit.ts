import type {
  EntityDefinition,
  EntityEditScreenDefinition,
  FieldCondition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import {
  evalFieldCondition,
  isExtensionEditSection,
  normalizeEditField,
  parseRefTarget,
} from "@cosmicdrift/kumiko-framework/ui-types";
import {
  buildOptionLabels,
  embeddedCellLabelKey,
  embeddedCellOptionLabelKey,
  fieldLabelKey,
  fieldOptionLabelKey,
} from "./list";
import type {
  EditFieldViewModel,
  EditSectionViewModel,
  EditViewModel,
  EmbeddedListCellViewModel,
  Translate,
} from "./types";

// Sub-field shape read off an EmbeddedFieldDef.schema entry. Mirrors
// EmbeddedSubFieldDef from packages/types/src/fields.ts — headless only
// depends on @cosmicdrift/kumiko-framework/ui-types (client-safe subset),
// which doesn't re-export the embedded types, so this stays a local cast
// shape like every other field-type narrowing in this file.
type EmbeddedSubFieldShape = {
  readonly type:
    | "text"
    | "number"
    | "boolean"
    | "date"
    | "money"
    | "decimal"
    | "select"
    | "reference"
    | "timestamp";
  readonly required?: boolean;
  readonly options?: readonly string[];
  readonly entity?: string;
  readonly labelField?: string;
};

export type ComputeEditViewModelInput<
  TValues extends Readonly<Record<string, unknown>> = Readonly<Record<string, unknown>>,
> = {
  readonly screen: EntityEditScreenDefinition;
  readonly entity: EntityDefinition;
  readonly values: TValues;
  readonly translate: Translate;
  readonly featureName: string;
};

// Pure transform from screen-def + entity-def + row-values to the flat
// section/field tree the renderer draws. FieldConditions are evaluated here
// so the renderer never re-runs them during React render.
export function computeEditViewModel<
  TValues extends Readonly<Record<string, unknown>> = Readonly<Record<string, unknown>>,
>(input: ComputeEditViewModelInput<TValues>): EditViewModel {
  const { screen, entity, values, translate, featureName } = input;

  const sections: EditSectionViewModel[] = screen.layout.sections.map((sectionSpec) => {
    if (isExtensionEditSection(sectionSpec)) {
      return {
        kind: "extension" as const,
        title: translate(sectionSpec.title),
        component: sectionSpec.component,
      };
    }
    const fields: EditFieldViewModel[] = sectionSpec.fields.map((fieldSpec) => {
      const normalized = normalizeEditField(fieldSpec);
      const fieldDef = entity.fields[normalized.field];
      if (!fieldDef) {
        throw new Error(
          `computeEditViewModel: screen "${screen.id}" references unknown field "${normalized.field}" on entity "${screen.entity}"`,
        );
      }
      const label = translate(
        screen.fieldLabels?.[normalized.field] ??
          fieldLabelKey(featureName, screen.entity, normalized.field),
      );
      const visible = evalCondition(normalized.visible, true, values);
      // `readOnly` (camelCase) is the name on both sides: EditFieldSpec
      // in the engine, and the view-model emitted here. One convention
      // through the stack beats translating at the boundary.
      const readOnly = evalCondition(normalized.readOnly, false, values);
      // `required` on the field-spec overrides the entity-default. A
      // field that's required at the entity-level but marked required:
      // false on the screen (e.g. a soft-onboarding wizard that
      // collects less up-front) respects the screen override.
      const entityRequired = (fieldDef as unknown as { required?: boolean }).required === true;
      const required = evalCondition(normalized.required, entityRequired, values);
      // Select-Optionen bei `type: "select"` mitnehmen — der Renderer
      // braucht sie für das Dropdown ohne nochmal die EntityDefinition
      // zu reichen. Plus translated Labels (gleiche Convention wie der
      // List-Builder), damit Form-Selects und List-Cells dieselbe
      // i18n-Quelle teilen.
      const options =
        fieldDef.type === "select"
          ? ((fieldDef as unknown as { options?: readonly string[] }).options ?? [])
          : undefined;
      const optionLabels =
        options !== undefined
          ? buildOptionLabels(
              translate,
              (value) => fieldOptionLabelKey(featureName, screen.entity, normalized.field, value),
              options,
            )
          : undefined;
      // Multiline-Hint bei `type: "text"` — der Renderer wechselt
      // dann auf textarea. ViewModel hält die Form-Render-Decision
      // damit der Renderer nicht selbst auf die FieldDefinition greift.
      const multiline =
        fieldDef.type === "text"
          ? (fieldDef as unknown as { multiline?: boolean | { rows?: number } }).multiline
          : undefined;
      // Wall-Clock-Hint bei `type: "timestamp"` mit locatedBy — der
      // Renderer emittiert dann lokale Zeit ohne `Z` statt UTC-Instant.
      const wallClock =
        fieldDef.type === "timestamp" &&
        (fieldDef as unknown as { locatedBy?: string }).locatedBy !== undefined
          ? true
          : undefined;
      // Datumsgrenzen + Format/Locale-Override bei date/timestamp — der
      // Renderer begrenzt damit den Picker. Quelle: Date/TimestampFieldDef.
      const dateBounds =
        fieldDef.type === "date" ||
        fieldDef.type === "timestamp" ||
        fieldDef.type === "locatedTimestamp"
          ? (fieldDef as unknown as { min?: string; max?: string; locale?: string })
          : undefined;
      const min = dateBounds?.min;
      const max = dateBounds?.max;
      const dateLocale = dateBounds?.locale;
      // Tier 2.7e-3: Reference-Field — refEntity + refLabelField in
      // das ViewModel reichen damit der Renderer die Lookup-Query
      // bauen kann ohne noch an EntityDefinition zu greifen.
      // Tier 2.7e-3: Reference-Field — entity-String kann same-feature
      // ("user") oder cross-feature ("users:user") sein. parseRefTarget
      // splittet das, der Renderer baut die Lookup-QN aus
      // (refFeature, refEntity).
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
      const refMultiple =
        fieldDef.type === "reference"
          ? ((fieldDef as unknown as { multiple?: boolean }).multiple ?? false)
          : undefined;
      // file/image: accept/maxSize ins ViewModel + entityType/fieldName für
      // den Upload-POST (Endpoint validiert gegen die richtige Field-Def).
      const isFileType = fieldDef.type === "file" || fieldDef.type === "image";
      const fileDef = isFileType
        ? (fieldDef as unknown as { accept?: readonly string[]; maxSize?: string })
        : undefined;
      // Embedded-LIST field (`multiple: true`) — per-cell metadata for a
      // renderer to draw one row per array item (invoice-positions-style
      // table). A plain (non-list) embedded field emits none of this; the
      // renderer tells the two apart by whether embeddedListCells is set,
      // not by `type` (which stays "embedded" either way).
      const isEmbeddedList =
        fieldDef.type === "embedded" &&
        (fieldDef as unknown as { multiple?: boolean }).multiple === true;
      const embeddedListDef = isEmbeddedList
        ? (fieldDef as unknown as {
            schema: Readonly<Record<string, EmbeddedSubFieldShape>>;
            minItems?: number;
            maxItems?: number;
            derived?: Readonly<
              Record<
                string,
                { readonly op: "multiply" | "sum" | "subtract"; readonly from: readonly string[] }
              >
            >;
            totals?: readonly string[];
          })
        : undefined;
      const embeddedListCells: readonly EmbeddedListCellViewModel[] | undefined =
        embeddedListDef !== undefined
          ? Object.entries(embeddedListDef.schema).map(([subFieldName, subField]) => {
              const cellLabel = translate(
                embeddedCellLabelKey(featureName, screen.entity, normalized.field, subFieldName),
              );
              const cellOptions = subField.type === "select" ? (subField.options ?? []) : undefined;
              const cellOptionLabels =
                cellOptions !== undefined
                  ? buildOptionLabels(
                      translate,
                      (value) =>
                        embeddedCellOptionLabelKey(
                          featureName,
                          screen.entity,
                          normalized.field,
                          subFieldName,
                          value,
                        ),
                      cellOptions,
                    )
                  : undefined;
              const cellRefTarget =
                subField.type === "reference" && subField.entity !== undefined
                  ? parseRefTarget(subField.entity, featureName)
                  : undefined;
              const cell: EmbeddedListCellViewModel = {
                field: subFieldName,
                label: cellLabel,
                type: subField.type,
                required: subField.required === true,
                ...(cellOptions !== undefined && { options: cellOptions }),
                ...(cellOptionLabels !== undefined && { optionLabels: cellOptionLabels }),
                ...(cellRefTarget !== undefined && { refEntity: cellRefTarget.entityName }),
                ...(cellRefTarget !== undefined && { refFeature: cellRefTarget.featureName }),
                ...(subField.type === "reference" &&
                  subField.labelField !== undefined && { refLabelField: subField.labelField }),
              };
              return cell;
            })
          : undefined;
      const view: EditFieldViewModel = {
        field: normalized.field,
        label,
        type: fieldDef.type,
        value: values[normalized.field],
        visible,
        readOnly,
        required,
        ...(normalized.span !== undefined && { span: normalized.span }),
        ...(normalized.renderer !== undefined && { renderer: normalized.renderer }),
        ...(options !== undefined && { options }),
        ...(optionLabels !== undefined && { optionLabels }),
        ...(multiline !== undefined && { multiline }),
        ...(wallClock !== undefined && { wallClock }),
        ...(min !== undefined && { min }),
        ...(max !== undefined && { max }),
        ...(dateLocale !== undefined && { dateLocale }),
        ...(refEntity !== undefined && { refEntity }),
        ...(refFeature !== undefined && { refFeature }),
        ...(refLabelField !== undefined && { refLabelField }),
        ...(refMultiple !== undefined && { refMultiple }),
        ...(fileDef?.accept !== undefined && { accept: fileDef.accept }),
        ...(fileDef?.maxSize !== undefined && { maxSize: fileDef.maxSize }),
        ...(isFileType && { entityType: screen.entity, fieldName: normalized.field }),
        ...(normalized.icon !== undefined && { icon: normalized.icon }),
        ...(embeddedListCells !== undefined && { embeddedListCells }),
        ...(embeddedListDef?.minItems !== undefined && {
          embeddedListMinItems: embeddedListDef.minItems,
        }),
        ...(embeddedListDef?.maxItems !== undefined && {
          embeddedListMaxItems: embeddedListDef.maxItems,
        }),
        ...(embeddedListDef?.derived !== undefined && {
          embeddedListDerived: embeddedListDef.derived,
        }),
        ...(embeddedListDef?.totals !== undefined && {
          embeddedListTotals: embeddedListDef.totals,
        }),
        // ponytail: "EUR" mirrors DEFAULT_CURRENCIES[0] from
        // framework/src/engine/field-helpers.ts — headless has no dependency
        // on that module, so the literal is duplicated here instead of
        // importing it just for one fallback string. Currency lives on the
        // head aggregate (entity.defaultCurrency), not per row — one value
        // for the whole embedded list.
        ...(embeddedListDef !== undefined && {
          embeddedListCurrency: entity.defaultCurrency ?? "EUR",
        }),
      };
      return view;
    });
    // Boot-validator rejects fields.length === 0 (screens.ts), so an empty
    // section never reaches this code.
    const visible = fields.some((field) => field.visible);
    return {
      kind: "fields" as const,
      visible,
      // Titellose Section (flache Form) → kein h3; nur übersetzen wenn gesetzt.
      ...(sectionSpec.title !== undefined && { title: translate(sectionSpec.title) }),
      ...(sectionSpec.description !== undefined && {
        description: translate(sectionSpec.description),
      }),
      columns: sectionSpec.columns ?? 1,
      fields,
    };
  });

  const id = (values["id"] as string | undefined) ?? null;

  return {
    screenId: screen.id,
    entityName: screen.entity,
    id,
    sections,
    ...(screen.slots && { slots: screen.slots }),
  };
}

// Resolves a FieldCondition against the current row values.
// `undefined` means "not declared" — caller substitutes the default.
function evalCondition<TValues>(
  condition: FieldCondition | undefined,
  fallback: boolean,
  values: TValues,
): boolean {
  if (condition === undefined) return fallback;
  // @cast-boundary view-model: TValues ist strukturell ein Record.
  return evalFieldCondition(condition, values as Record<string, unknown>);
}
