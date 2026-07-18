import {
  createEntity,
  createTextField,
  defineEntityDeleteHandler,
  defineFeature,
} from "@cosmicdrift/kumiko-framework/engine";

export const messageEntity = createEntity({
  table: "read_sample_messages",
  fields: {
    channel: createTextField({ required: true }),
    text: createTextField({ required: true }),
    author: createTextField(),
  },
  softDelete: true,
});

const userWrite = { access: { roles: ["Admin", "User"] } } as const;
const adminWrite = { access: { roles: ["Admin"] } } as const;

export const chatFeature = defineFeature("chat", (r) => {
  r.crud("message", messageEntity, {
    write: userWrite,
    verbs: { list: false, detail: false, restore: false, delete: false },
  });
  r.writeHandler(defineEntityDeleteHandler("message", messageEntity, adminWrite));
});
