// Entity + screen definitions. IS registered by the server in feature.ts via
// r.entity/r.screen; the browser-side mirror
// (clientSchema with navs/workspaces) is obsolete — the client loads the
// resolved AppSchema itself via the authenticated GET /api/schema.

import type {
  EntityDefinition,
  EntityEditScreenDefinition,
  EntityListScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";

export const orderEntity = {
  table: "read_ws_orders",
  fields: {
    label: { type: "text", required: true, sortable: true, allowPlaintext: "is_business_data" },
    status: { type: "text", sortable: true, allowPlaintext: "is_business_data" },
    notes: { type: "text", allowPlaintext: "is_business_data" },
  },
} as unknown as EntityDefinition;

export const orderListScreen: EntityListScreenDefinition = {
  id: "order-list",
  type: "entityList",
  entity: "order",
  columns: ["label", "status"],
  defaultSort: { field: "label", dir: "asc" },
  rowActions: [{ kind: "navigate", id: "edit", label: "demo:actions.edit", screen: "order-edit" }],
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
