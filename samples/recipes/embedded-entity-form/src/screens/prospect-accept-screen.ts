import type { EntityEditScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";

// Not registered via `r.screen` — no nav entry, no route. RenderEdit only
// reads `entity`/`layout` off this object, so a plain literal is enough to
// host it inside a Drawer.
export const prospectAcceptScreen: EntityEditScreenDefinition = {
  id: "prospect-accept-form",
  type: "entityEdit",
  entity: "prospect",
  layout: {
    sections: [{ fields: ["name", "email", "company", "notes"] }],
  },
};
