import { createEntity, createTextField, defineFeature } from "@cosmicdrift/kumiko-framework/engine";

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
  r.crud("note", noteEntity, {
    write: adminWrite,
    read: openRead,
    verbs: { update: false, delete: false, restore: false },
  });
});
