// Realtime SSE Sample
// Shows: SSE broadcast on create/update/delete via system hook.

import {
  createEntity,
  createTextField,
  defineEntityCreateHandler,
  defineEntityDeleteHandler,
  defineEntityUpdateHandler,
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

  r.writeHandler(defineEntityCreateHandler("message", messageEntity, userWrite));
  r.writeHandler(defineEntityUpdateHandler("message", messageEntity, userWrite));
  r.writeHandler(defineEntityDeleteHandler("message", messageEntity, adminWrite));
});
