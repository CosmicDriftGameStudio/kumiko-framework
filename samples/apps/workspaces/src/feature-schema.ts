// Entity + Screen-Definitionen. WIRD vom Server in feature.ts via
// r.entity/r.screen registriert; die Browser-seitige Spiegelung
// (clientSchema mit navs/workspaces) ist obsolet — der dev-server
// injiziert das aufgelöste AppSchema beim Boot, der Client liest es
// aus window.__KUMIKO_SCHEMA__.

import type {
  EntityDefinition,
  EntityEditScreenDefinition,
  EntityListScreenDefinition,
} from "@kumiko/framework/ui-types";

export const orderEntity = {
  table: "read_ws_orders",
  fields: {
    label: { type: "text", required: true, sortable: true },
    status: { type: "text", sortable: true },
    notes: { type: "text" },
  },
} as unknown as EntityDefinition;

export const orderListScreen: EntityListScreenDefinition = {
  id: "order-list",
  type: "entityList",
  entity: "order",
  columns: ["label", "status"],
};

export const orderEditScreen: EntityEditScreenDefinition = {
  id: "order-edit",
  type: "entityEdit",
  entity: "order",
  layout: {
    sections: [
      {
        title: "Order",
        columns: 2,
        fields: [{ field: "label", span: 2 }, "status", { field: "notes", span: 2 }],
      },
    ],
  },
};
