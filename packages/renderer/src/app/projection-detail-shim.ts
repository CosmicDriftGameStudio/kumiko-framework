// Shim für ProjectionDetail-Renderer (analog zu projection-list-shim.ts /
// config-edit-shim.ts).
//
// RenderEdit verlangt ein `entity: EntityDefinition` + ein
// `screen: EntityEditScreenDefinition`-Pair, nutzt davon aber nur
// `entity.fields` (Feld-Typ für den Input-Renderer) und `screen.layout`
// (welche Felder in welchen Sections). Ein projectionDetail-Screen ist
// query-getrieben und hat KEINE Entity — die zwei Helper hier shapen den
// Input ad-hoc um, damit RenderEdit reused werden kann.
//
// Der strukturelle Read-Only-Beweis liegt in synthesizeProjectionDetailScreen:
// JEDES Feld wird hart auf readOnly:true gesetzt (nicht nur was der Author im
// Layout gesetzt hat) — hasEditableSection() liest genau dieses Flag und
// blendet den Save-Button aus, wenn kein Feld editierbar ist. Der Author kann
// diese Garantie nicht versehentlich umgehen.
//
// Selbe Schulden-Reservation wie bei den anderen Shims: greift RenderEdit
// künftig auf weitere EntityDefinition-Felder (transitions, idType) zu, oder
// cross-referenziert ein Boot-Validator die schema.entities-Map, brechen die
// Type-Lies hier silent — dann ist Zeit für eine echte RenderProjectionDetail-
// Komponente.

import type {
  EditLayout,
  EntityDefinition,
  EntityEditScreenDefinition,
  ProjectionDetailScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import {
  isExtensionEditSection,
  normalizeEditField,
  PROJECTION_DETAIL_ENTITY as PROJECTION_DETAIL_PSEUDO_ENTITY,
} from "@cosmicdrift/kumiko-framework/ui-types";

/** Minimale EntityDefinition aus den Layout-Feldern: jedes Feld ein Text-
 *  Feld — computeEditViewModel liest nur `fields[<f>].type`, Text reicht für
 *  eine reine Anzeige (kein Select/Number-spezifisches Rendering nötig). */
export function synthesizeProjectionDetailEntity(layout: EditLayout): EntityDefinition {
  const fields: Record<string, { type: "text" }> = {};
  for (const section of layout.sections) {
    if (isExtensionEditSection(section)) continue; // rejected at boot, defensive here
    for (const spec of section.fields) {
      fields[normalizeEditField(spec).field] = { type: "text" };
    }
  }
  return { fields } as unknown as EntityDefinition;
}

/** Wandelt ein ProjectionDetailScreenDefinition in die EntityEditScreen-Shape
 *  die RenderEdit erwartet — mit jedem Feld hart auf readOnly:true erzwungen. */
export function synthesizeProjectionDetailScreen(
  screen: ProjectionDetailScreenDefinition,
): EntityEditScreenDefinition {
  const sections = screen.layout.sections.map((section) => {
    if (isExtensionEditSection(section)) return section; // rejected at boot, defensive here
    return {
      ...section,
      fields: section.fields.map((spec) => ({ ...normalizeEditField(spec), readOnly: true })),
    };
  });
  return {
    id: screen.id,
    type: "entityEdit",
    entity: PROJECTION_DETAIL_PSEUDO_ENTITY,
    layout: { sections },
    allowCreate: false,
    allowDelete: false,
    ...(screen.fieldLabels !== undefined && { fieldLabels: screen.fieldLabels }),
    ...(screen.slots !== undefined && { slots: screen.slots }),
    ...(screen.access !== undefined && { access: screen.access }),
  };
}
