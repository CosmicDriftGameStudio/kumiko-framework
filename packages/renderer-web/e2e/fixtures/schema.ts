// Minimales AppSchema fürs renderer-web/e2e — eine Entity, ein
// entityList + entityEdit Screen. Reicht um Form-Render, Submit-Flow,
// List-Render zu beweisen ohne Auth/Tenant/Multi-Feature-Komplexität.
//
// Kein Server-Bootstrap: das Schema wird im Browser direkt an
// createKumikoApp gehängt (keine window.__KUMIKO_SCHEMA__-Injection).

import type {
  EntityDefinition,
  EntityEditScreenDefinition,
  EntityListScreenDefinition,
} from "@kumiko/framework/ui-types";
import type { AppSchema } from "@kumiko/renderer-web";

export const thingEntity = {
  fields: {
    label: { type: "text", required: true, sortable: true },
    isDone: { type: "boolean", default: false },
    notes: { type: "text" },
    status: { type: "select", options: ["draft", "active", "done"], default: "draft" },
  },
} as unknown as EntityDefinition;

export const thingListScreen: EntityListScreenDefinition = {
  id: "thing-list",
  type: "entityList",
  entity: "thing",
  columns: ["label", "isDone", "status"],
};

export const thingEditScreen: EntityEditScreenDefinition = {
  id: "thing-edit",
  type: "entityEdit",
  entity: "thing",
  layout: {
    sections: [
      {
        title: "Thing",
        columns: 2,
        fields: [
          { field: "label", span: 2 },
          "isDone",
          "status",
          { field: "notes", span: 2 },
        ],
      },
    ],
  },
};

export const e2eSchema: AppSchema = {
  features: [
    {
      featureName: "test",
      entities: { thing: thingEntity },
      screens: [thingEditScreen, thingListScreen],
      navs: [
        { id: "thing-list", label: "Things", screen: "thing-list", order: 10 },
        { id: "thing-new", label: "New Thing", screen: "thing-edit", order: 20 },
      ],
    },
  ],
};
