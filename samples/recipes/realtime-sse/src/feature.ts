import { createPresenceFeature } from "@cosmicdrift/kumiko-bundled-features/presence";
import {
  createEntity,
  createTextField,
  defineEntityDeleteHandler,
  defineFeature,
} from "@cosmicdrift/kumiko-framework/engine";

export const messageEntity = createEntity({
  table: "read_sample_messages",
  fields: {
    channel: createTextField({ personal: false, reason: "is_business_data", required: true }),
    text: createTextField({ personal: { of: "id" }, find: "none", required: true }),
    author: createTextField({ personal: { of: "id" }, find: "none" }),
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

// Who else has a message open. The heartbeat is an ordinary write; the others learn about a
// change through an SSE frame addressed to them (`presence:event:changed`, no names inside),
// then refetch with `usePresence` / `usePresenceList` on the client.
export const presenceFeature = createPresenceFeature({
  entities: ["message"],
  roles: ["Admin", "User"],
});
