// Tenant Isolation Sample
// Shows: Multi-tenant data separation — Tenant A cannot see Tenant B's data.

import {
  createEntity,
  createTextField,
  defineEntityQueryHandler,
  defineEntityWriteHandler,
  defineFeature,
} from "@kumiko/framework/engine";

export const noteEntity = createEntity({
  table: "read_sample_notes",
  fields: {
    title: createTextField({ required: true }),
    content: createTextField(),
  },
});

const adminWrite = { access: { roles: ["Admin"] } } as const;
const openRead = { access: { openToAll: true } } as const;

export const noteFeature = defineFeature("notes", (r) => {
  r.entity("note", noteEntity);

  r.writeHandler(defineEntityWriteHandler("note:create", noteEntity, adminWrite));
  r.queryHandler(defineEntityQueryHandler("note:list", noteEntity, openRead));
  r.queryHandler(defineEntityQueryHandler("note:detail", noteEntity, openRead));
});
