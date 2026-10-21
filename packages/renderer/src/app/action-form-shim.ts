// Shim for ActionForm rendering.
//
// RenderEdit currently requires an `entity: EntityDefinition` and a
// `screen: EntityEditScreenDefinition` pair, but internally uses only
// `entity.fields` and `screen.layout`. ActionForm screens have neither an
// entity reference nor `type: "entityEdit"`; these helpers reshape the input
// so RenderEdit can be reused without duplicating the rendering stack.
//
// This workaround becomes invalid if RenderEdit starts reading
// entity.transitions, idType, defaultCurrency, or softDelete, or if a future
// boot validator cross-references the schema.entities map. At that point,
// RenderActionForm should accept `fields` directly. The boot validator already
// handles actionForm independently without an entity lookup, so the server path
// is unaffected.

import type {
  ActionFormScreenDefinition,
  EditFieldSpec,
  EditSectionSpec,
  EntityDefinition,
  EntityEditScreenDefinition,
  FieldDefinition,
  SecretMintConfirmStep,
  SecretMintScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import {
  ACTION_FORM_PSEUDO_ENTITY,
  isFieldsEditSection,
  normalizeEditField,
  sectionFieldSpecs,
} from "@cosmicdrift/kumiko-framework/ui-types";

/** Builds a minimal EntityDefinition from the inline fields of an
 *  ActionForm or SecretMint screen. RenderEdit and computeEditViewModel
 *  iterate over entity.fields at render time; all other EntityDefinition
 *  fields remain undefined. */
export function synthesizeActionFormEntity(
  fields: Readonly<Record<string, FieldDefinition>>,
): EntityDefinition {
  return { fields } as EntityDefinition;
}

// An actionForm has no create/update mode, so the entityEdit `writeExcludedFields`
// (which hides the field in create mode) does not fit. The values arrive via prefill
// (row drawer, handoff, URL), so show them read-only: `submit: false` because the
// handler does not accept the field, `required: false` so an empty one cannot block submit.
function lockExcludedFieldSpec(spec: EditFieldSpec, excluded: ReadonlySet<string>): EditFieldSpec {
  const normalized = normalizeEditField(spec);
  if (!excluded.has(normalized.field)) return spec;
  return { ...normalized, readOnly: true, required: false, submit: false };
}

function lockExcludedFieldsInSection(
  section: EditSectionSpec,
  excluded: ReadonlySet<string>,
): EditSectionSpec {
  if (!isFieldsEditSection(section)) return section;
  return {
    ...section,
    ...("fields" in section && {
      fields: section.fields.map((spec) => lockExcludedFieldSpec(spec, excluded)),
    }),
    ...("groups" in section && {
      groups: section.groups.map((group) => ({
        ...group,
        fields: group.fields.map((spec) => lockExcludedFieldSpec(spec, excluded)),
      })),
    }),
  };
}

function layoutWithLockedExcludedFields(
  screen: ActionFormScreenDefinition | SecretMintScreenDefinition,
): EntityEditScreenDefinition["layout"] {
  if (screen.type !== "actionForm" || !screen.writeExcludedFields?.length) return screen.layout;
  const excluded = new Set(screen.writeExcludedFields);
  return {
    ...screen.layout,
    sections: screen.layout.sections.map((section) =>
      lockExcludedFieldsInSection(section, excluded),
    ),
  };
}

/** Fields the form may seed and submit. An excluded field the layout does not show
 *  would otherwise reach the payload through its `default`, and the handler rejects it. */
export function actionFormSubmittableFields(
  screen: ActionFormScreenDefinition,
): Readonly<Record<string, FieldDefinition>> {
  const excluded = screen.writeExcludedFields;
  if (!excluded?.length) return screen.fields;
  const inLayout = new Set(
    screen.layout.sections.flatMap((section) =>
      isFieldsEditSection(section)
        ? sectionFieldSpecs(section).map((spec) => normalizeEditField(spec).field)
        : [],
    ),
  );
  return Object.fromEntries(
    Object.entries(screen.fields).filter(
      ([name]) => inLayout.has(name) || !excluded.includes(name),
    ),
  );
}

/** Converts an ActionFormScreenDefinition or SecretMintScreenDefinition to
 *  the EntityEditScreen shape expected by RenderEdit. `type` is set to
 *  "entityEdit" to satisfy the type constraint, and `entity` is pinned to
 *  the pseudo-name because RenderEdit does not read that field. */
export function synthesizeActionFormScreen(
  screen: ActionFormScreenDefinition | SecretMintScreenDefinition,
): EntityEditScreenDefinition {
  return {
    id: screen.id,
    type: "entityEdit",
    entity: ACTION_FORM_PSEUDO_ENTITY,
    layout: layoutWithLockedExcludedFields(screen),
    ...(screen.description !== undefined && { description: screen.description }),
    ...(screen.access !== undefined && { access: screen.access }),
    // Only ActionFormScreenDefinition carries slots/fieldLabels; `in` narrows
    // without a cast since SecretMintScreenDefinition has neither.
    ...("slots" in screen && screen.slots !== undefined && { slots: screen.slots }),
    ...("fillHeight" in screen &&
      screen.fillHeight !== undefined && { fillHeight: screen.fillHeight }),
    ...("fieldLabels" in screen &&
      screen.fieldLabels !== undefined && { fieldLabels: screen.fieldLabels }),
  };
}

/** Separate id (`${screen.id}:confirm`) keeps this confirm-form screen from
 *  colliding with the mint-form screen's draft key. */
export function synthesizeSecretMintConfirmScreen(
  screen: SecretMintScreenDefinition,
  confirm: SecretMintConfirmStep,
): EntityEditScreenDefinition {
  return {
    id: `${screen.id}:confirm`,
    type: "entityEdit",
    entity: ACTION_FORM_PSEUDO_ENTITY,
    layout: confirm.layout,
    ...(screen.access !== undefined && { access: screen.access }),
  };
}
