// Shim for the ProjectionDetail renderer (analogous to projection-list-shim.ts /
// config-edit-shim.ts).
//
// RenderEdit requires an `entity: EntityDefinition` +
// `screen: EntityEditScreenDefinition` pair, but only uses
// `entity.fields` (field type for the input renderer) and `screen.layout`
// (which fields belong in which sections). A projectionDetail screen is
// query-driven and has NO Entity — these two helpers shape the input ad hoc
// so RenderEdit can be reused.
//
// The structural read-only guarantee is established in
// synthesizeProjectionDetailScreen: EVERY field is forced to readOnly:true
// (not just fields the author marked in the layout) — hasEditableSection()
// reads exactly this flag and hides the Save button when no field is
// editable. The author cannot accidentally bypass this guarantee.
//
// Same debt reservation as in the other shims: if RenderEdit later accesses
// additional EntityDefinition fields (transitions, idType), or a boot
// validator cross-references the schema.entities map, these type lies will
// fail silently — then it is time for a real RenderProjectionDetail
// component.

import type {
  EditFieldSpec,
  EditLayout,
  EntityDefinition,
  EntityEditScreenDefinition,
  ProjectionDetailScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import {
  isFieldsEditSection,
  normalizeEditField,
  PROJECTION_DETAIL_ENTITY as PROJECTION_DETAIL_PSEUDO_ENTITY,
  sectionFieldSpecs,
} from "@cosmicdrift/kumiko-framework/ui-types";
import { SYNTHESIZED_FIELD_PII_REASON } from "./projection-list-shim.ts";

/** Minimal EntityDefinition built from the layout fields: every field is a text
 *  field — computeEditViewModel only reads `fields[<f>].type`, and text is
 *  sufficient for display-only rendering (no Select/Number-specific rendering
 *  is needed). */
export function synthesizeProjectionDetailEntity(
  layout: EditLayout,
): Pick<EntityDefinition, "fields"> {
  const fields: Record<string, EntityDefinition["fields"][string]> = {};
  for (const section of layout.sections) {
    // relatedList and extension sections carry no `fields` to synthesize.
    if (!isFieldsEditSection(section)) continue;
    for (const spec of sectionFieldSpecs(section)) {
      const { field, format } = normalizeEditField(spec);
      fields[field] = {
        type: "text",
        allowPlaintext: SYNTHESIZED_FIELD_PII_REASON,
        ...(format !== undefined && { format }),
      };
    }
  }
  return { fields };
}

/** Converts a ProjectionDetailScreenDefinition to the EntityEditScreen shape
 *  expected by RenderEdit, with every field forcibly set to readOnly:true. */
export function synthesizeProjectionDetailScreen(
  screen: ProjectionDetailScreenDefinition,
): EntityEditScreenDefinition {
  const forceReadOnly = (spec: EditFieldSpec) => ({ ...normalizeEditField(spec), readOnly: true });
  const sections = screen.layout.sections.map((section) => {
    // relatedList and extension sections pass through unchanged.
    if (!isFieldsEditSection(section)) return section;
    return {
      ...section,
      ...("fields" in section && { fields: section.fields.map(forceReadOnly) }),
      ...("groups" in section && {
        groups: section.groups.map((group) => ({
          ...group,
          fields: group.fields.map(forceReadOnly),
        })),
      }),
    };
  });
  return {
    id: screen.id,
    type: "entityEdit",
    entity: PROJECTION_DETAIL_PSEUDO_ENTITY,
    layout: { sections, ...(screen.layout.width !== undefined && { width: screen.layout.width }) },
    allowCreate: false,
    allowDelete: false,
    ...(screen.description !== undefined && { description: screen.description }),
    ...(screen.recordTitleField !== undefined && { recordTitleField: screen.recordTitleField }),
    ...(screen.fieldLabels !== undefined && { fieldLabels: screen.fieldLabels }),
    ...(screen.slots !== undefined && { slots: screen.slots }),
    ...(screen.access !== undefined && { access: screen.access }),
    ...(screen.fillHeight !== undefined && { fillHeight: screen.fillHeight }),
  };
}
