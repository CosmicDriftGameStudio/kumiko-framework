// Realtime SSE Sample
// Shows: SSE broadcast on create/update/delete via system hook.

import {
  createEntity,
  createTextField,
  defineEntityWriteHandler,
  defineFeature,
} from "@kumiko/framework/engine";

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
  r.entity("message", messageEntity);

  r.writeHandler(defineEntityWriteHandler("message:create", messageEntity, userWrite));
  r.writeHandler(defineEntityWriteHandler("message:update", messageEntity, userWrite));
  r.writeHandler(defineEntityWriteHandler("message:delete", messageEntity, adminWrite));
});
