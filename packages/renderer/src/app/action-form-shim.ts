// Shim für ActionForm-Renderer (Tier 2.7d).
//
// RenderEdit verlangt heute eine `entity: EntityDefinition` + ein
// `screen: EntityEditScreenDefinition` Pair, nutzt aber intern nur
// `entity.fields` und `screen.layout`. ActionForm-Screens haben weder
// eine Entity-Reference noch sind sie type: "entityEdit" — die zwei
// Helper hier shapen den Daten-Input ad-hoc um, damit RenderEdit
// reused werden kann ohne den Stack zu duplizieren.
//
// Schulden-Flag: Sobald RenderEdit auf entity.transitions / idType /
// defaultCurrency / softDelete zugreift, oder ein zukünftiger Boot-
// Validator die schema.entities-Map cross-referenziert, brechen die
// Type-Lies hier silent. Dann ist es Zeit für eine echte
// RenderActionForm-Komponente, die `fields` direkt als Input nimmt.
// Der Boot-Validator kennt actionForm bereits eigenständig (kein
// entity-Lookup), also ist der Server-Pfad davon nicht betroffen.

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
  isFieldsEditSection,
  normalizeEditField,
  sectionFieldSpecs,
} from "@cosmicdrift/kumiko-framework/ui-types";

const ACTION_FORM_PSEUDO_ENTITY = "__action-form__";

/** Baut eine minimale EntityDefinition aus den Inline-Fields eines
 *  ActionForm- oder SecretMint-Screens. RenderEdit + computeEditViewModel
 *  iterieren über entity.fields zur Render-Zeit; alle weiteren
 *  EntityDefinition-Felder bleiben undefined. */
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
    // kumiko-lint-ignore section-fields-raw rewrites both sources in place — the groups branch below does the same for groups[].fields
    fields: section.fields.map((spec) => lockExcludedFieldSpec(spec, excluded)),
    ...(section.groups !== undefined && {
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

/** Wandelt ein ActionFormScreenDefinition oder SecretMintScreenDefinition in
 *  die EntityEditScreen-Shape die RenderEdit erwartet. type wird auf
 *  "entityEdit" gesetzt damit der Type-Constraint hält; entity wird auf den
 *  Pseudo-Namen gepinnt — RenderEdit liest das Feld nicht. */
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
