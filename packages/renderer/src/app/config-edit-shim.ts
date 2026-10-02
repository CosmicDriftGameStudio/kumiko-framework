// Shim für ConfigEdit-Renderer (analog zu action-form-shim.ts).
//
// RenderEdit verlangt eine `entity: EntityDefinition` + ein
// `screen: EntityEditScreenDefinition` Pair, nutzt aber intern nur
// `entity.fields` und `screen.layout` für das Rendern. ConfigEdit-
// Screens haben weder eine Entity-Reference noch sind sie
// type: "entityEdit" — die zwei Helper hier shapen den Daten-Input
// ad-hoc um, damit RenderEdit reused werden kann.
//
// Selbe Schulden-Reservation wie bei action-form-shim: sobald RenderEdit
// auf entity.transitions / idType / softDelete zugreift, oder ein
// zukünftiger Boot-Validator die schema.entities-Map cross-referenziert,
// brechen die Type-Lies hier silent. Dann ist Zeit für eine echte
// RenderConfigEdit-Komponente die direkt fields nimmt.

import type {
  ConfigEditScreenDefinition,
  EntityDefinition,
  EntityEditScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import { I18N_KEY_PARAM } from "@cosmicdrift/kumiko-headless";
import * as z from "zod";

const CONFIG_EDIT_PSEUDO_ENTITY = "__config-edit__";

/** Baut eine minimale EntityDefinition aus den Inline-Fields des
 *  ConfigEdit-Screens. RenderEdit + computeEditViewModel iterieren
 *  über entity.fields zur Render-Zeit; alle weiteren EntityDefinition-
 *  Felder bleiben undefined. */
export function synthesizeConfigEditEntity(
  fields: ConfigEditScreenDefinition["fields"],
): EntityDefinition {
  return { fields } as EntityDefinition;
}

/** Wandelt ein ConfigEditScreenDefinition in die EntityEditScreen-
 *  Shape die RenderEdit erwartet. type wird auf "entityEdit" gesetzt
 *  damit der Type-Constraint hält; entity wird auf den Pseudo-Namen
 *  gepinnt — RenderEdit liest das Feld nicht. */
export function synthesizeConfigEditScreen(
  screen: ConfigEditScreenDefinition,
): EntityEditScreenDefinition {
  return {
    id: screen.id,
    type: "entityEdit",
    entity: CONFIG_EDIT_PSEUDO_ENTITY,
    layout: screen.layout,
    ...(screen.description !== undefined && { description: screen.description }),
    ...(screen.fieldLabels !== undefined && { fieldLabels: screen.fieldLabels }),
    ...(screen.access !== undefined && { access: screen.access }),
  };
}

/** Client-side range check for number keys with declared bounds, so an
 *  out-of-range value surfaces on its field instead of as the server's
 *  form-level "Validation failed." banner. Only bounds: required/format stay
 *  server-authoritative like in buildFormSchema. `.passthrough()` keeps every
 *  form key visible to the superRefine. */
export function buildConfigEditSchema(fields: ConfigEditScreenDefinition["fields"]): z.ZodType {
  return z
    .object({})
    .passthrough()
    .superRefine((values, ctx) => {
      // @cast-boundary form-values
      const record = values as Record<string, unknown>;
      for (const [name, field] of Object.entries(fields)) {
        if (field.type !== "number") continue;
        const value = record[name];
        if (typeof value !== "number" || !Number.isFinite(value)) continue;
        if (field.min !== undefined && value < field.min) {
          ctx.addIssue({
            code: "custom",
            minimum: field.min,
            params: { [I18N_KEY_PARAM]: "kumiko.validation.number.min" },
            path: [name],
          });
        }
        if (field.max !== undefined && value > field.max) {
          ctx.addIssue({
            code: "custom",
            maximum: field.max,
            params: { [I18N_KEY_PARAM]: "kumiko.validation.number.max" },
            path: [name],
          });
        }
      }
    });
}
