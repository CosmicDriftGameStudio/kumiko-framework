// Entity + screen definitions. IS registered by the server in feature.ts via
// r.entity/r.screen; the browser-side mirror
// (clientSchema with navs/workspaces) is obsolete — the client loads the
// resolved AppSchema itself via the authenticated GET /api/schema.

import { createEntity, createTextField } from "@cosmicdrift/kumiko-framework/engine";
import type {
  EntityEditScreenDefinition,
  EntityListScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";

export const orderEntity = createEntity({
  table: "read_ws_orders",
  fields: {
    label: createTextField({
      personal: false,
      reason: "is_business_data",
      required: true,
      sortable: true,
    }),
    status: createTextField({ personal: false, reason: "is_business_data", sortable: true }),
    notes: createTextField({ personal: false, reason: "is_business_data" }),
  },
});

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
