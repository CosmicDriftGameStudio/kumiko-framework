// Shim for the ConfigEdit renderer (analogous to action-form-shim.ts).
//
// RenderEdit requires an `entity: EntityDefinition` +
// `screen: EntityEditScreenDefinition` pair, but internally uses only
// `entity.fields` and `screen.layout` for rendering. ConfigEdit screens
// have neither an entity reference nor `type: "entityEdit"` — these two
// helpers reshape the data input ad hoc so RenderEdit can be reused.
//
// The same debt reservation as in action-form-shim applies: if RenderEdit
// starts accessing entity.transitions / idType / softDelete, or a future
// boot validator cross-references the schema.entities map, these type lies
// will fail silently. At that point, a real RenderConfigEdit component
// that takes fields directly is needed.

import type {
  ConfigEditScreenDefinition,
  EntityDefinition,
  EntityEditScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import * as z from "zod";
import { I18N_KEY_PARAM } from "../headless/index.ts";

const CONFIG_EDIT_PSEUDO_ENTITY = "__config-edit__";

/** Builds a minimal EntityDefinition from the ConfigEdit screen's inline
 *  fields. RenderEdit + computeEditViewModel iterate over entity.fields
 *  at render time; all other EntityDefinition fields remain undefined. */
export function synthesizeConfigEditEntity(
  fields: ConfigEditScreenDefinition["fields"],
): EntityDefinition {
  return { fields } as EntityDefinition;
}

/** Converts a ConfigEditScreenDefinition to the EntityEditScreen shape
 *  expected by RenderEdit. `type` is set to "entityEdit" to satisfy the
 *  type constraint; `entity` is pinned to the pseudo-name — RenderEdit
 *  does not read this field. */
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
