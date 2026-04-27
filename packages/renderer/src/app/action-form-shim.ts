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
  EntityDefinition,
  EntityEditScreenDefinition,
} from "@kumiko/framework/ui-types";

const ACTION_FORM_PSEUDO_ENTITY = "__action-form__";

/** Baut eine minimale EntityDefinition aus den Inline-Fields des
 *  ActionForm-Screens. RenderEdit + computeEditViewModel iterieren
 *  über entity.fields zur Render-Zeit; alle weiteren EntityDefinition-
 *  Felder bleiben undefined. */
export function synthesizeActionFormEntity(
  fields: ActionFormScreenDefinition["fields"],
): EntityDefinition {
  return { fields } as EntityDefinition;
}

/** Wandelt ein ActionFormScreenDefinition in die EntityEditScreen-
 *  Shape die RenderEdit erwartet. type wird auf "entityEdit" gesetzt
 *  damit der Type-Constraint hält; entity wird auf den Pseudo-Namen
 *  gepinnt — RenderEdit liest das Feld nicht. */
export function synthesizeActionFormScreen(
  screen: ActionFormScreenDefinition,
): EntityEditScreenDefinition {
  return {
    id: screen.id,
    type: "entityEdit",
    entity: ACTION_FORM_PSEUDO_ENTITY,
    layout: screen.layout,
    ...(screen.access !== undefined && { access: screen.access }),
  };
}
