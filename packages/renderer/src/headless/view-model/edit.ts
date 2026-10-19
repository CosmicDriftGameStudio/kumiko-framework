import type {
  EditExtensionSection,
  EditFieldSpec,
  EditRelatedListSection,
  EditWriteFormSection,
  EmbeddedListEditSpec,
  EntityDefinition,
  EntityEditScreenDefinition,
  FieldAffix,
  FieldCondition,
  ParsedRefTarget,
} from "@cosmicdrift/kumiko-framework/ui-types";
import {
  availableSelectOptions,
  evalFieldCondition,
  isExtensionEditSection,
  isFieldsEditSection,
  isWriteFormEditSection,
  normalizeEditField,
  parseRefTarget,
  sectionFieldSpecs,
  WRITE_FORM_SECTION_ENTITY,
} from "@cosmicdrift/kumiko-framework/ui-types";
import type { AnyFileFieldDef } from "@cosmicdrift/kumiko-types/fields";
import {
  buildOptionLabels,
  embeddedCellLabelKey,
  embeddedCellOptionLabelKey,
  fieldLabelKey,
  fieldOptionLabelKey,
} from "./list.ts";
import type {
  EditFieldViewModel,
  EditRelatedListSectionViewModel,
  EditSectionViewModel,
  EditViewModel,
  EditWriteFormSectionViewModel,
  EmbeddedListCellViewModel,
  Translate,
} from "./types.ts";

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
  readonly optionsQuery?: string;
  readonly scale?: number;
  readonly display?: "radio" | "dropdown";
};

export type ComputeEditViewModelInput<
  TValues extends Readonly<Record<string, unknown>> = Readonly<Record<string, unknown>>,
> = {
  readonly screen: EntityEditScreenDefinition;
  readonly entity: EntityDefinition;
  readonly values: TValues;
  readonly translate: Translate;
  readonly featureName: string;
  /** Which write the form drives. Applies the screen's `writeExcludedFields`
   *  for that verb (create hides them, update shows them read-only); omitted
   *  means no exclusion applies. */
  readonly mode?: EditFormMode;
  /** The record being edited; omitted on create. */
  readonly entityId?: string;
};

export type EditFormMode = "create" | "update";

// Resolves a writeForm section's own fieldDefs/fields through the same
// per-field pipeline as a plain fields section, by reusing the pipeline
// itself rather than duplicating it: wrap fieldDefs/fields as a throwaway
// entityEdit screen (same "synthesize a pseudo-entity" idiom as the shims in
// packages/renderer/src/app/*-shim.ts) and recurse into computeEditViewModel
// once. Split out of computeEditViewModel's section-map to keep that
// function's own complexity from absorbing this branch's decision points.
function computeWriteFormSectionViewModel<TValues extends Readonly<Record<string, unknown>>>(
  sectionSpec: EditWriteFormSection,
  screenId: string,
  values: TValues,
  translate: Translate,
  featureName: string,
): EditWriteFormSectionViewModel {
  const innerEntity: EntityDefinition = { fields: sectionSpec.fieldDefs } as EntityDefinition;
  const innerScreen: EntityEditScreenDefinition = {
    id: `${screenId}:${sectionSpec.id ?? "write-form"}`,
    type: "entityEdit",
    entity: WRITE_FORM_SECTION_ENTITY,
    layout: {
      sections: [{ kind: "fields", fields: sectionSpec.fields, columns: sectionSpec.columns }],
    },
  };
  const inner = computeEditViewModel({
    screen: innerScreen,
    entity: innerEntity,
    values,
    translate,
    featureName,
  });
  const innerSection = inner.sections[0];
  const fields = innerSection?.kind === "fields" ? innerSection.fields : [];
  return {
    kind: "writeForm" as const,
    ...(sectionSpec.title !== undefined && { title: translate(sectionSpec.title) }),
    ...(sectionSpec.description !== undefined && {
      description: translate(sectionSpec.description),
    }),
    columns: sectionSpec.columns ?? 1,
    fields,
    ...(sectionSpec.icon !== undefined && { icon: sectionSpec.icon }),
    handler: sectionSpec.handler,
    ...(sectionSpec.submitLabel !== undefined && {
      submitLabel: translate(sectionSpec.submitLabel),
    }),
    ...(sectionSpec.actions !== undefined && { actions: sectionSpec.actions }),
  };
}

function wasEmptiedByWriteExclusion(
  declaredFieldSpecs: readonly EditFieldSpec[],
  remainingFields: readonly EditFieldViewModel[],
): boolean {
  return declaredFieldSpecs.length > 0 && remainingFields.length === 0;
}

// relatedList runs its own query — nothing here to resolve against
// entity/values, the spec passes through verbatim (fw#2166).
export function computeRelatedListSectionViewModel(
  sectionSpec: EditRelatedListSection,
  translate: Translate,
): EditRelatedListSectionViewModel {
  return {
    kind: "relatedList" as const,
    title: translate(sectionSpec.title),
    query: sectionSpec.query,
    ...(sectionSpec.parentParam !== undefined && { parentParam: sectionSpec.parentParam }),
    ...(sectionSpec.parentFilter !== undefined && { parentFilter: sectionSpec.parentFilter }),
    columns: sectionSpec.columns,
    ...(sectionSpec.entity !== undefined && { entity: sectionSpec.entity }),
    ...(sectionSpec.description !== undefined && {
      description: translate(sectionSpec.description),
    }),
    ...(sectionSpec.itemNoun !== undefined && { itemNoun: sectionSpec.itemNoun }),
    ...(sectionSpec.pageSize !== undefined && { pageSize: sectionSpec.pageSize }),
    ...(sectionSpec.defaultSort !== undefined && { defaultSort: sectionSpec.defaultSort }),
    ...(sectionSpec.searchable !== undefined && { searchable: sectionSpec.searchable }),
    ...(sectionSpec.facets !== undefined && { facets: sectionSpec.facets }),
    ...(sectionSpec.rowClick !== undefined && { rowClick: sectionSpec.rowClick }),
    ...(sectionSpec.rowActions !== undefined && { rowActions: sectionSpec.rowActions }),
    ...(sectionSpec.rowActionMode !== undefined && { rowActionMode: sectionSpec.rowActionMode }),
    ...(sectionSpec.groupBy !== undefined && { groupBy: sectionSpec.groupBy }),
    ...(sectionSpec.rowTone !== undefined && { rowTone: sectionSpec.rowTone }),
    ...(sectionSpec.toolbarActions !== undefined && { toolbarActions: sectionSpec.toolbarActions }),
    ...(sectionSpec.actions !== undefined && { actions: sectionSpec.actions }),
    ...(sectionSpec.emptyState !== undefined && {
      emptyState: {
        title: translate(sectionSpec.emptyState.title),
        ...(sectionSpec.emptyState.description !== undefined && {
          description: translate(sectionSpec.emptyState.description),
        }),
        // Action stays untranslated, same convention as rowActions/
        // toolbarActions above — the renderer's row-actions builder
        // translates `action.label` at button-build time.
        ...(sectionSpec.emptyState.action !== undefined && {
          action: sectionSpec.emptyState.action,
        }),
      },
    }),
  };
}

// --- Per-field-type view-model hints ------------------------------------
// Split out of the field-map callback below (was one function covering
// every field type's derivation, growing into a single complexity hotspot)
// so each field-type family stays its own small, independently reviewable
// unit. Pure data derivation, no side effects — each returns only the keys
// its own field type ever sets.

type EntityFieldDef = NonNullable<EntityDefinition["fields"][string]>;
type NormalizedEditField = ReturnType<typeof normalizeEditField>;

function translateAffix(affix: FieldAffix, translate: Translate): FieldAffix {
  return typeof affix === "string" ? translate(affix) : affix;
}

type FieldAffixHints = Pick<EditFieldViewModel, "placeholder" | "prefix" | "suffix" | "fillAction">;

function deriveFieldAffixHints(
  normalized: NormalizedEditField,
  translate: Translate,
): FieldAffixHints {
  return {
    ...(normalized.placeholder !== undefined && { placeholder: translate(normalized.placeholder) }),
    ...(normalized.prefix !== undefined && {
      prefix: translateAffix(normalized.prefix, translate),
    }),
    ...(normalized.suffix !== undefined && {
      suffix: translateAffix(normalized.suffix, translate),
    }),
    ...(normalized.fillAction !== undefined && {
      fillAction: { ...normalized.fillAction, label: translate(normalized.fillAction.label) },
    }),
  };
}

type SelectFieldHints = Pick<
  EditFieldViewModel,
  | "options"
  | "optionLabels"
  | "display"
  | "columns"
  | "maxRows"
  | "selectOptionsQuery"
  | "selectOptionsAvailabilityQuery"
>;

function deriveSelectOptionsQuery(
  fieldDef: EntityFieldDef,
): Pick<EditFieldViewModel, "selectOptionsQuery"> {
  return fieldDef.type === "select" && fieldDef.optionsQuery !== undefined
    ? {
        selectOptionsQuery: {
          query: fieldDef.optionsQuery,
          payload: fieldDef.optionsQueryPayload ?? {},
        },
      }
    : {};
}

function deriveSelectOptionsAvailabilityQuery(
  fieldDef: EntityFieldDef,
): Pick<EditFieldViewModel, "selectOptionsAvailabilityQuery"> {
  if (fieldDef.type === "multiSelect") {
    return fieldDef.optionsAvailabilityQuery !== undefined
      ? {
          selectOptionsAvailabilityQuery: { query: fieldDef.optionsAvailabilityQuery, payload: {} },
        }
      : {};
  }
  return fieldDef.type === "select" && fieldDef.optionsAvailabilityQuery !== undefined
    ? {
        selectOptionsAvailabilityQuery: {
          query: fieldDef.optionsAvailabilityQuery,
          payload: fieldDef.optionsQueryPayload ?? {},
        },
      }
    : {};
}

// A stored value that conditionalOptions no longer allows stays listed, so the
// form shows it (flagged on submit) instead of silently dropping it.
function selectableOptions(
  fieldDef: EntityFieldDef,
  fieldName: string,
  values: Readonly<Record<string, unknown>>,
): readonly string[] | undefined {
  if (fieldDef.type === "multiSelect") return fieldDef.options;
  if (fieldDef.type !== "select") return undefined;
  if (!fieldDef.conditionalOptions) return fieldDef.options;
  const available = availableSelectOptions(fieldDef, values);
  const current = values[fieldName];
  return fieldDef.options.filter((option) => available.includes(option) || option === current);
}

function deriveSelectFieldHints(
  fieldDef: EntityFieldDef,
  translate: Translate,
  featureName: string,
  entityName: string,
  fieldName: string,
  values: Readonly<Record<string, unknown>>,
): SelectFieldHints {
  const options = selectableOptions(fieldDef, fieldName, values);
  const optionLabels =
    options !== undefined
      ? buildOptionLabels(
          translate,
          (value) => fieldOptionLabelKey(featureName, entityName, fieldName, value),
          options,
        )
      : undefined;
  const declaredDisplay =
    fieldDef.type === "multiSelect" || fieldDef.type === "select" ? fieldDef.display : undefined;
  // The renderer's heuristic counts options, so a filtered list would switch widgets with the discriminator.
  const display =
    declaredDisplay ??
    (fieldDef.type === "select" && fieldDef.conditionalOptions ? "dropdown" : undefined);
  const columns = fieldDef.type === "multiSelect" ? fieldDef.columns : undefined;
  const maxRows = fieldDef.type === "multiSelect" ? fieldDef.maxRows : undefined;
  return {
    ...deriveSelectOptionsQuery(fieldDef),
    ...deriveSelectOptionsAvailabilityQuery(fieldDef),
    ...(options !== undefined && { options }),
    ...(optionLabels !== undefined && { optionLabels }),
    ...(display !== undefined && { display }),
    ...(columns !== undefined && { columns }),
    ...(maxRows !== undefined && { maxRows }),
  };
}

type TextFieldHints = Pick<
  EditFieldViewModel,
  "multiline" | "format" | "writeOnly" | "sensitive" | "autoComplete"
>;

function deriveTextFieldHints(fieldDef: EntityFieldDef): TextFieldHints {
  const multiline =
    fieldDef.type === "text" || fieldDef.type === "longText" ? fieldDef.multiline : undefined;
  const format = fieldDef.type === "text" ? fieldDef.format : undefined;
  const writeOnly = fieldDef.type === "text" && fieldDef.writeOnly === true;
  const autoComplete = fieldDef.type === "text" ? fieldDef.autoComplete : undefined;
  return {
    ...(multiline !== undefined && { multiline }),
    ...(autoComplete !== undefined && { autoComplete }),
    ...(format !== undefined && { format }),
    ...(writeOnly && { writeOnly: true as const }),
    ...("sensitive" in fieldDef && fieldDef.sensitive === true && { sensitive: true as const }),
  };
}

type DateFieldHints = Pick<EditFieldViewModel, "wallClock" | "min" | "max" | "dateLocale">;

function deriveDateFieldHints(fieldDef: EntityFieldDef): DateFieldHints {
  const wallClock =
    fieldDef.type === "timestamp" &&
    (fieldDef as unknown as { locatedBy?: string }).locatedBy !== undefined
      ? true
      : undefined;
  const dateBounds =
    fieldDef.type === "date" ||
    fieldDef.type === "timestamp" ||
    fieldDef.type === "locatedTimestamp"
      ? (fieldDef as unknown as { min?: string; max?: string; locale?: string })
      : undefined;
  return {
    ...(wallClock !== undefined && { wallClock }),
    ...(dateBounds?.min !== undefined && { min: dateBounds.min }),
    ...(dateBounds?.max !== undefined && { max: dateBounds.max }),
    ...(dateBounds?.locale !== undefined && { dateLocale: dateBounds.locale }),
  };
}

type NumericFieldHints = Pick<EditFieldViewModel, "grouping" | "currency" | "unit">;

function deriveNumericFieldHints(
  fieldDef: EntityFieldDef,
  resolvedCurrency: string,
): NumericFieldHints {
  const grouping = fieldDef.type === "number" ? fieldDef.grouping : undefined;
  return {
    ...(grouping !== undefined && { grouping }),
    ...(fieldDef.type === "money" && { currency: resolvedCurrency }),
    ...(fieldDef.type === "number" && fieldDef.unit !== undefined && { unit: fieldDef.unit }),
  };
}

type ReferenceFieldHints = Pick<
  EditFieldViewModel,
  "refEntity" | "refFeature" | "refLabelField" | "refOptionsQuery" | "refMultiple"
>;

// Declared reference metadata (EditFieldSpec.refEntity) takes priority over
// fieldDef.type — see computeEditViewModel's effectiveType, same reasoning.
function deriveReferenceFieldHints(
  fieldDef: EntityFieldDef,
  normalized: NormalizedEditField,
  declaredRefTarget: ParsedRefTarget | undefined,
  featureName: string,
): ReferenceFieldHints {
  const refRaw =
    declaredRefTarget === undefined && fieldDef.type === "reference"
      ? (fieldDef as unknown as { entity?: string }).entity
      : undefined;
  const refTarget =
    declaredRefTarget ?? (refRaw !== undefined ? parseRefTarget(refRaw, featureName) : undefined);
  const refLabelField =
    declaredRefTarget !== undefined
      ? (normalized.refLabelField ?? "id")
      : fieldDef.type === "reference"
        ? ((fieldDef as unknown as { labelField?: string }).labelField ?? "id")
        : undefined;
  return {
    ...(refTarget?.entityName !== undefined && { refEntity: refTarget.entityName }),
    ...(refTarget?.featureName !== undefined && { refFeature: refTarget.featureName }),
    ...(refLabelField !== undefined && { refLabelField }),
    ...deriveReferenceMultiHints(fieldDef, declaredRefTarget),
  };
}

type ReferenceMultiHints = Pick<EditFieldViewModel, "refOptionsQuery" | "refMultiple">;

// Declared reference metadata has no `multiple` or `optionsQuery` concept
// (it targets row-meta/derived fields, always single-valued and resolved
// through the target entity) — only a real ReferenceFieldDef carries them.
function deriveReferenceMultiHints(
  fieldDef: EntityFieldDef,
  declaredRefTarget: ParsedRefTarget | undefined,
): ReferenceMultiHints {
  const ownReferenceDef =
    declaredRefTarget === undefined && fieldDef.type === "reference"
      ? (fieldDef as unknown as { multiple?: boolean; optionsQuery?: string })
      : undefined;
  const refMultiple =
    ownReferenceDef === undefined ? undefined : (ownReferenceDef.multiple ?? false);
  return {
    ...(ownReferenceDef?.optionsQuery !== undefined && {
      refOptionsQuery: ownReferenceDef.optionsQuery,
    }),
    ...(refMultiple !== undefined && { refMultiple }),
  };
}

type FileFieldHints = Pick<
  EditFieldViewModel,
  | "accept"
  | "maxSize"
  | "maxCount"
  | "entityType"
  | "entityId"
  | "fieldName"
  | "imageVariant"
  | "capture"
>;

// file/image: entityType/fieldName travel with the upload POST so the
// endpoint validates against the right field definition.
function isFileFieldType(fieldDef: EntityFieldDef): fieldDef is AnyFileFieldDef {
  return (
    fieldDef.type === "file" ||
    fieldDef.type === "image" ||
    fieldDef.type === "files" ||
    fieldDef.type === "images"
  );
}

function deriveImageHints(
  fieldDef: AnyFileFieldDef,
): Pick<EditFieldViewModel, "imageVariant" | "capture"> {
  if (fieldDef.type !== "image" && fieldDef.type !== "images") return {};
  const imageVariant = Object.keys(fieldDef.variants ?? {})[0];
  return {
    ...(imageVariant !== undefined && { imageVariant }),
    ...(fieldDef.capture !== undefined && { capture: fieldDef.capture }),
  };
}

function deriveFileFieldHints(
  fieldDef: EntityFieldDef,
  entityName: string,
  fieldName: string,
  entityId: string | undefined,
): FileFieldHints {
  if (!isFileFieldType(fieldDef)) return {};
  const maxCount =
    fieldDef.type === "files" || fieldDef.type === "images" ? fieldDef.maxCount : undefined;
  return {
    ...(fieldDef.accept !== undefined && { accept: fieldDef.accept }),
    ...(fieldDef.maxSize !== undefined && { maxSize: fieldDef.maxSize }),
    ...(maxCount !== undefined && { maxCount }),
    entityType: entityName,
    fieldName,
    ...(entityId !== undefined && { entityId }),
    ...deriveImageHints(fieldDef),
  };
}

type EmbeddedListHints = Pick<
  EditFieldViewModel,
  | "embeddedListCells"
  | "embeddedListMinItems"
  | "embeddedListMaxItems"
  | "embeddedListDerived"
  | "embeddedListTotals"
  | "embeddedListCurrency"
  | "embeddedListFixedRows"
>;

type EmbeddedCellSelectHints = Pick<EmbeddedListCellViewModel, "options" | "optionLabels">;
type EmbeddedCellReferenceHints = Pick<
  EmbeddedListCellViewModel,
  "refEntity" | "refFeature" | "refLabelField" | "refOptionsQuery"
>;

function deriveEmbeddedCellSelectHints(
  subField: EmbeddedSubFieldShape,
  translate: Translate,
  featureName: string,
  entityName: string,
  fieldName: string,
  subFieldName: string,
): EmbeddedCellSelectHints {
  if (subField.type !== "select") return {};
  const options = subField.options ?? [];
  return {
    options,
    optionLabels: buildOptionLabels(
      translate,
      (value) =>
        embeddedCellOptionLabelKey(featureName, entityName, fieldName, subFieldName, value),
      options,
    ),
  };
}

function deriveEmbeddedCellReferenceHints(
  subField: EmbeddedSubFieldShape,
  featureName: string,
): EmbeddedCellReferenceHints {
  if (subField.type !== "reference") return {};
  const target =
    subField.entity !== undefined ? parseRefTarget(subField.entity, featureName) : undefined;
  return {
    ...(target !== undefined && { refEntity: target.entityName, refFeature: target.featureName }),
    ...(subField.labelField !== undefined && { refLabelField: subField.labelField }),
    ...(subField.optionsQuery !== undefined && { refOptionsQuery: subField.optionsQuery }),
  };
}

function buildEmbeddedListCell(
  subFieldName: string,
  subField: EmbeddedSubFieldShape,
  translate: Translate,
  featureName: string,
  entityName: string,
  fieldName: string,
  listSpec: EmbeddedListEditSpec | undefined,
): EmbeddedListCellViewModel {
  return {
    field: subFieldName,
    label: translate(embeddedCellLabelKey(featureName, entityName, fieldName, subFieldName)),
    type: subField.type,
    required: subField.required === true,
    ...deriveEmbeddedCellSelectHints(
      subField,
      translate,
      featureName,
      entityName,
      fieldName,
      subFieldName,
    ),
    ...deriveEmbeddedCellReferenceHints(subField, featureName),
    ...(subField.type === "decimal" && subField.scale !== undefined && { scale: subField.scale }),
    ...(subField.type === "select" &&
      subField.display !== undefined && { display: subField.display }),
    ...(listSpec?.readOnlyCells?.includes(subFieldName) === true && { readOnly: true }),
  };
}

// Embedded-LIST field (`multiple: true`) — per-cell metadata for a renderer
// to draw one row per array item (invoice-positions-style table). A plain
// (non-list) embedded field emits none of this; the renderer tells the two
// apart by whether embeddedListCells is set, not by `type` (which stays
// "embedded" either way).
function deriveEmbeddedListHints(
  fieldDef: EntityFieldDef,
  translate: Translate,
  featureName: string,
  entityName: string,
  fieldName: string,
  resolvedCurrency: string,
  listSpec: EmbeddedListEditSpec | undefined,
): EmbeddedListHints {
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
      ? Object.entries(embeddedListDef.schema).map(([subFieldName, subField]) =>
          buildEmbeddedListCell(
            subFieldName,
            subField,
            translate,
            featureName,
            entityName,
            fieldName,
            listSpec,
          ),
        )
      : undefined;
  return {
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
    // Currency lives on the head aggregate (entity.defaultCurrency), not per
    // row — one value for the whole embedded list.
    ...(embeddedListDef !== undefined && { embeddedListCurrency: resolvedCurrency }),
    ...(embeddedListDef !== undefined &&
      listSpec?.fixedRows === true && { embeddedListFixedRows: true }),
  };
}

function buildExtensionSectionViewModel(
  sectionSpec: EditExtensionSection,
  translate: Translate,
): Extract<EditSectionViewModel, { kind: "extension" }> {
  const entityNameOverride = sectionSpec.entityName?.trim();
  return {
    kind: "extension" as const,
    ...(sectionSpec.id !== undefined && { id: sectionSpec.id }),
    title: translate(sectionSpec.title),
    component: sectionSpec.component,
    contributesToFormSubmit: sectionSpec.contributesToFormSubmit === true,
    // Blank override must fall back to the host value: the renderer's `??`
    // would otherwise pass "" through to the mounted extension.
    ...(entityNameOverride !== undefined &&
      entityNameOverride.length > 0 && { entityName: entityNameOverride }),
    ...(sectionSpec.actions !== undefined && { actions: sectionSpec.actions }),
  };
}

// Pure transform from screen-def + entity-def + row-values to the flat
// section/field tree the renderer draws. FieldConditions are evaluated here
// so the renderer never re-runs them during React render.
export function computeEditViewModel<
  TValues extends Readonly<Record<string, unknown>> = Readonly<Record<string, unknown>>,
>(input: ComputeEditViewModelInput<TValues>): EditViewModel {
  const { screen, entity, values, translate, featureName, mode, entityId } = input;
  const excludedFields = new Set(mode === undefined ? [] : screen.writeExcludedFields?.[mode]);
  const isHiddenByExclusion = (fieldSpec: EditFieldSpec): boolean =>
    mode === "create" && excludedFields.has(normalizeEditField(fieldSpec).field);

  const sections: EditSectionViewModel[] = screen.layout.sections.map((sectionSpec) => {
    if (isExtensionEditSection(sectionSpec)) {
      return buildExtensionSectionViewModel(sectionSpec, translate);
    }
    if (isWriteFormEditSection(sectionSpec)) {
      return computeWriteFormSectionViewModel(
        sectionSpec,
        screen.id,
        values,
        translate,
        featureName,
      );
    }
    if (!isFieldsEditSection(sectionSpec)) {
      return computeRelatedListSectionViewModel(sectionSpec, translate);
    }
    // `groups` flattens into the same per-field pipeline as plain `fields`;
    // the group structure below just re-groups the computed views by name.
    const declaredFieldSpecs = sectionFieldSpecs(sectionSpec);
    const fields: EditFieldViewModel[] = declaredFieldSpecs
      .filter((fieldSpec) => !isHiddenByExclusion(fieldSpec))
      .map((fieldSpec) => {
        const normalized = normalizeEditField(fieldSpec);
        const fieldDef = entity.fields[normalized.field];
        if (!fieldDef) {
          throw new Error(
            `computeEditViewModel: screen "${screen.id}" references unknown field "${normalized.field}" on entity "${screen.entity}"`,
          );
        }
        // Declared reference metadata (EditFieldSpec.refEntity) — for
        // projectionDetail fields, which have no EntityDefinition field to
        // carry a real "reference" type. Takes priority over fieldDef.type
        // below so it also fires against the pseudo-entity that hardcodes
        // every field as "text" (projection-detail-shim) — real entityEdit
        // screens never set this, so their fieldDef.type === "reference"
        // branch is unaffected.
        // A real non-text field (e.g. a `reference` with `multiple`) keeps its own
        // type and hints, as documented on EditFieldSpec.refEntity; the shim's
        // pseudo-entity only ever declares "text".
        const declaredRefTarget =
          normalized.refEntity !== undefined && fieldDef.type === "text"
            ? parseRefTarget(normalized.refEntity, featureName)
            : undefined;
        const effectiveType = declaredRefTarget !== undefined ? "reference" : fieldDef.type;
        const label = translate(
          screen.fieldLabels?.[normalized.field] ??
            fieldLabelKey(featureName, screen.entity, normalized.field),
        );
        const visible = evalCondition(normalized.visible, true, values);
        // `readOnly` (camelCase) is the name on both sides: EditFieldSpec
        // in the engine, and the view-model emitted here. One convention
        // through the stack beats translating at the boundary.
        const readOnly =
          (mode === "update" && excludedFields.has(normalized.field)) ||
          evalCondition(normalized.readOnly, false, values);
        // `required` on the field-spec overrides the entity-default. A
        // field that's required at the entity-level but marked required:
        // false on the screen (e.g. a soft-onboarding wizard that
        // collects less up-front) respects the screen override.
        const entityRequired = (fieldDef as unknown as { required?: boolean }).required === true;
        const required = evalCondition(normalized.required, entityRequired, values);
        // ponytail: "EUR" mirrors DEFAULT_CURRENCIES[0] from
        // framework/src/engine/field-helpers.ts — headless has no dependency
        // on that module, so the literal is duplicated here instead of
        // importing it just for one fallback string.
        const resolvedCurrency = entity.defaultCurrency ?? "EUR";
        const selectHints = deriveSelectFieldHints(
          fieldDef,
          translate,
          featureName,
          screen.entity,
          normalized.field,
          values,
        );
        const textHints = deriveTextFieldHints(fieldDef);
        const dateHints = deriveDateFieldHints(fieldDef);
        const numericHints = deriveNumericFieldHints(fieldDef, resolvedCurrency);
        const referenceHints = deriveReferenceFieldHints(
          fieldDef,
          normalized,
          declaredRefTarget,
          featureName,
        );
        const fileHints = deriveFileFieldHints(fieldDef, screen.entity, normalized.field, entityId);
        const embeddedListHints = deriveEmbeddedListHints(
          fieldDef,
          translate,
          featureName,
          screen.entity,
          normalized.field,
          resolvedCurrency,
          normalized.embeddedList,
        );
        const view: EditFieldViewModel = {
          field: normalized.field,
          label,
          type: effectiveType,
          value: values[normalized.field],
          visible,
          readOnly,
          required,
          ...(normalized.span !== undefined && { span: normalized.span }),
          ...(normalized.renderer !== undefined && { renderer: normalized.renderer }),
          ...selectHints,
          ...textHints,
          ...dateHints,
          ...numericHints,
          ...referenceHints,
          ...fileHints,
          ...(normalized.icon !== undefined && { icon: normalized.icon }),
          ...deriveFieldAffixHints(normalized, translate),
          ...embeddedListHints,
        };
        return view;
      });
    // The boot-validator rejects declared-empty sections (screens.ts), but a
    // create-excluded field list can still empty one here: then `visible` is false.
    const visible = fields.some((field) => field.visible);
    // Tabs mode renders this section as its own panel, where two columns reads
    // better than the single-column default a stacked form keeps. Applies to
    // entityEdit tabs as well since fw#3134, not just projectionDetail.
    const defaultColumns = screen.layout.mode === "tabs" ? 2 : 1;
    const groups = sectionSpec.groups
      ?.map((group) => ({ ...group, fields: group.fields.filter((f) => !isHiddenByExclusion(f)) }))
      .filter((group) => group.fields.length > 0)
      .map((group) => ({
        title: translate(group.title),
        columns: group.columns ?? 2,
        fields: group.fields.map((fieldSpec) => {
          const fieldName = normalizeEditField(fieldSpec).field;
          const fieldView = fields.find((f) => f.field === fieldName);
          if (fieldView === undefined) {
            throw new Error(
              `computeEditViewModel: screen "${screen.id}" group "${group.title}" references field ` +
                `"${fieldName}" that failed to resolve.`,
            );
          }
          return fieldView;
        }),
      }));
    return {
      kind: "fields" as const,
      ...(sectionSpec.id !== undefined && { id: sectionSpec.id }),
      visible,
      emptiedByWriteExclusion: wasEmptiedByWriteExclusion(declaredFieldSpecs, fields),
      // Untitled section (flat form) → no h3; translate only when set.
      ...(sectionSpec.title !== undefined && { title: translate(sectionSpec.title) }),
      ...(sectionSpec.description !== undefined && {
        description: translate(sectionSpec.description),
      }),
      ...(sectionSpec.subtitle !== undefined && { subtitle: translate(sectionSpec.subtitle) }),
      columns: sectionSpec.columns ?? defaultColumns,
      fields,
      ...(groups !== undefined && { groups }),
      ...(sectionSpec.icon !== undefined && { icon: sectionSpec.icon }),
      ...(sectionSpec.actions !== undefined && { actions: sectionSpec.actions }),
    };
  });

  const idValue = values["id"];
  const id = typeof idValue === "string" ? idValue : null;

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
function evalCondition<TValues extends Readonly<Record<string, unknown>>>(
  condition: FieldCondition | undefined,
  fallback: boolean,
  values: TValues,
): boolean {
  if (condition === undefined) return fallback;
  return evalFieldCondition(condition, values);
}
