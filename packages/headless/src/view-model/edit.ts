import type {
  EntityDefinition,
  EntityEditScreenDefinition,
  FieldCondition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import {
  isExtensionEditSection,
  normalizeEditField,
  parseRefTarget,
} from "@cosmicdrift/kumiko-framework/ui-types";
import { buildOptionLabels, fieldLabelKey } from "./list";
import type { EditFieldViewModel, EditSectionViewModel, EditViewModel, Translate } from "./types";

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
      const label = translate(fieldLabelKey(featureName, screen.entity, normalized.field));
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
          ? buildOptionLabels(translate, featureName, screen.entity, normalized.field, options)
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
        ...(refEntity !== undefined && { refEntity }),
        ...(refFeature !== undefined && { refFeature }),
        ...(refLabelField !== undefined && { refLabelField }),
        ...(refMultiple !== undefined && { refMultiple }),
      };
      return view;
    });
    return {
      kind: "fields" as const,
      title: translate(sectionSpec.title),
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
  if (typeof condition === "boolean") return condition;
  const val = (values as Record<string, unknown>)[condition.field];
  if ("eq" in condition) return val === condition.eq;
  return val !== condition.ne;
}
