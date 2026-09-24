import type {
  EditExtensionSection,
  EditRelatedListSection,
  EditWriteFormSection,
  EntityDefinition,
  EntityEditScreenDefinition,
  FieldCondition,
  ParsedRefTarget,
} from "@cosmicdrift/kumiko-framework/ui-types";
import {
  evalFieldCondition,
  isExtensionEditSection,
  isFieldsEditSection,
  isWriteFormEditSection,
  normalizeEditField,
  parseRefTarget,
  sectionFieldSpecs,
  WRITE_FORM_SECTION_ENTITY,
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
  EditRelatedListSectionViewModel,
  EditSectionViewModel,
  EditViewModel,
  EditWriteFormSectionViewModel,
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
  readonly optionsQuery?: string;
  readonly scale?: number;
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

// relatedList runs its own query — nothing here to resolve against
// entity/values, the spec passes through verbatim (fw#2166).
function computeRelatedListSectionViewModel(
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
    ...(sectionSpec.pageSize !== undefined && { pageSize: sectionSpec.pageSize }),
    ...(sectionSpec.defaultSort !== undefined && { defaultSort: sectionSpec.defaultSort }),
    ...(sectionSpec.searchable !== undefined && { searchable: sectionSpec.searchable }),
    ...(sectionSpec.facets !== undefined && { facets: sectionSpec.facets }),
    ...(sectionSpec.rowClick !== undefined && { rowClick: sectionSpec.rowClick }),
    ...(sectionSpec.rowActions !== undefined && { rowActions: sectionSpec.rowActions }),
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

type SelectFieldHints = Pick<
  EditFieldViewModel,
  "options" | "optionLabels" | "display" | "columns" | "maxRows"
>;

function deriveSelectFieldHints(
  fieldDef: EntityFieldDef,
  translate: Translate,
  featureName: string,
  entityName: string,
  fieldName: string,
): SelectFieldHints {
  const options =
    fieldDef.type === "select" || fieldDef.type === "multiSelect"
      ? ((fieldDef as unknown as { options?: readonly string[] }).options ?? [])
      : undefined;
  const optionLabels =
    options !== undefined
      ? buildOptionLabels(
          translate,
          (value) => fieldOptionLabelKey(featureName, entityName, fieldName, value),
          options,
        )
      : undefined;
  const display =
    fieldDef.type === "multiSelect" || fieldDef.type === "select" ? fieldDef.display : undefined;
  const columns = fieldDef.type === "multiSelect" ? fieldDef.columns : undefined;
  const maxRows = fieldDef.type === "multiSelect" ? fieldDef.maxRows : undefined;
  return {
    ...(options !== undefined && { options }),
    ...(optionLabels !== undefined && { optionLabels }),
    ...(display !== undefined && { display }),
    ...(columns !== undefined && { columns }),
    ...(maxRows !== undefined && { maxRows }),
  };
}

type TextFieldHints = Pick<EditFieldViewModel, "multiline" | "format">;

function deriveTextFieldHints(fieldDef: EntityFieldDef): TextFieldHints {
  const multiline =
    fieldDef.type === "text" || fieldDef.type === "longText"
      ? (fieldDef as unknown as { multiline?: boolean | { rows?: number } }).multiline
      : undefined;
  const format =
    fieldDef.type === "text"
      ? (fieldDef as unknown as { format?: "email" | "url" | "phone" | "password" }).format
      : undefined;
  return {
    ...(multiline !== undefined && { multiline }),
    ...(format !== undefined && { format }),
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
  "accept" | "maxSize" | "entityType" | "fieldName" | "imageVariant" | "capture"
>;

// file/image: entityType/fieldName travel with the upload POST so the
// endpoint validates against the right field definition.
function deriveFileFieldHints(
  fieldDef: EntityFieldDef,
  entityName: string,
  fieldName: string,
): FileFieldHints {
  const isFileType =
    fieldDef.type === "file" || fieldDef.type === "image" || fieldDef.type === "images";
  const fileDef = isFileType
    ? (fieldDef as unknown as {
        accept?: readonly string[];
        maxSize?: string;
        variants?: Readonly<Record<string, unknown>>;
        capture?: "environment" | "user";
      })
    : undefined;
  const imageVariant =
    fieldDef.type === "image" || fieldDef.type === "images"
      ? Object.keys(fileDef?.variants ?? {})[0]
      : undefined;
  const capture = fieldDef.type === "image" ? fileDef?.capture : undefined;
  return {
    ...(fileDef?.accept !== undefined && { accept: fileDef.accept }),
    ...(fileDef?.maxSize !== undefined && { maxSize: fileDef.maxSize }),
    ...(isFileType && { entityType: entityName, fieldName }),
    ...(imageVariant !== undefined && { imageVariant }),
    ...(capture !== undefined && { capture }),
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
>;

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
      ? Object.entries(embeddedListDef.schema).map(([subFieldName, subField]) => {
          const cellLabel = translate(
            embeddedCellLabelKey(featureName, entityName, fieldName, subFieldName),
          );
          const cellOptions = subField.type === "select" ? (subField.options ?? []) : undefined;
          const cellOptionLabels =
            cellOptions !== undefined
              ? buildOptionLabels(
                  translate,
                  (value) =>
                    embeddedCellOptionLabelKey(
                      featureName,
                      entityName,
                      fieldName,
                      subFieldName,
                      value,
                    ),
                  cellOptions,
                )
              : undefined;
          const cellRef = subField.type === "reference" ? subField : undefined;
          const cellRefTarget =
            cellRef?.entity !== undefined ? parseRefTarget(cellRef.entity, featureName) : undefined;
          const cell: EmbeddedListCellViewModel = {
            field: subFieldName,
            label: cellLabel,
            type: subField.type,
            required: subField.required === true,
            ...(cellOptions !== undefined && { options: cellOptions }),
            ...(cellOptionLabels !== undefined && { optionLabels: cellOptionLabels }),
            ...(cellRefTarget !== undefined && { refEntity: cellRefTarget.entityName }),
            ...(cellRefTarget !== undefined && { refFeature: cellRefTarget.featureName }),
            ...(cellRef?.labelField !== undefined && { refLabelField: cellRef.labelField }),
            ...(cellRef?.optionsQuery !== undefined && {
              refOptionsQuery: cellRef.optionsQuery,
            }),
            ...(subField.type === "decimal" &&
              subField.scale !== undefined && { scale: subField.scale }),
          };
          return cell;
        })
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
  };
}

function buildExtensionSectionViewModel(
  sectionSpec: EditExtensionSection,
  translate: Translate,
): Extract<EditSectionViewModel, { kind: "extension" }> {
  return {
    kind: "extension" as const,
    ...(sectionSpec.id !== undefined && { id: sectionSpec.id }),
    title: translate(sectionSpec.title),
    component: sectionSpec.component,
    contributesToFormSubmit: sectionSpec.contributesToFormSubmit === true,
    ...(sectionSpec.entityName !== undefined && { entityName: sectionSpec.entityName }),
    ...(sectionSpec.actions !== undefined && { actions: sectionSpec.actions }),
  };
}

// Pure transform from screen-def + entity-def + row-values to the flat
// section/field tree the renderer draws. FieldConditions are evaluated here
// so the renderer never re-runs them during React render.
export function computeEditViewModel<
  TValues extends Readonly<Record<string, unknown>> = Readonly<Record<string, unknown>>,
>(input: ComputeEditViewModelInput<TValues>): EditViewModel {
  const { screen, entity, values, translate, featureName } = input;

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
    const fields: EditFieldViewModel[] = sectionFieldSpecs(sectionSpec).map((fieldSpec) => {
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
      const declaredRefTarget =
        normalized.refEntity !== undefined
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
      const readOnly = evalCondition(normalized.readOnly, false, values);
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
      const fileHints = deriveFileFieldHints(fieldDef, screen.entity, normalized.field);
      const embeddedListHints = deriveEmbeddedListHints(
        fieldDef,
        translate,
        featureName,
        screen.entity,
        normalized.field,
        resolvedCurrency,
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
        ...embeddedListHints,
      };
      return view;
    });
    // Boot-validator rejects fields.length === 0 with no groups (screens.ts),
    // so an empty section never reaches this code.
    const visible = fields.some((field) => field.visible);
    // Tabs mode renders this section as its own panel, where two columns reads
    // better than the single-column default a stacked form keeps. Applies to
    // entityEdit tabs as well since fw#3134, not just projectionDetail.
    const defaultColumns = screen.layout.mode === "tabs" ? 2 : 1;
    const groups = sectionSpec.groups?.map((group) => ({
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
      // Titellose Section (flache Form) → kein h3; nur übersetzen wenn gesetzt.
      ...(sectionSpec.title !== undefined && { title: translate(sectionSpec.title) }),
      ...(sectionSpec.description !== undefined && {
        description: translate(sectionSpec.description),
      }),
      columns: sectionSpec.columns ?? defaultColumns,
      fields,
      ...(groups !== undefined && { groups }),
      ...(sectionSpec.icon !== undefined && { icon: sectionSpec.icon }),
      ...(sectionSpec.actions !== undefined && { actions: sectionSpec.actions }),
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
