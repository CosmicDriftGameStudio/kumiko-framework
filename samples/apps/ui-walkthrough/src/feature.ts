// Server-side feature registration. Handler + pipeline wiring lives
// here; the static shape (entity + screens) is imported from
// feature-schema.ts and shared with the client. Splitting the file
// keeps this one's server-only imports (defineFeature,
// defineEntityWriteHandler) out of the browser bundle.

import {
  defineEntityQueryHandler,
  defineEntityWriteHandler,
  defineFeature,
} from "@kumiko/framework/engine";
import { editScreen, listScreen, taskEntity } from "./feature-schema";

// Re-export so the server bootstrap (server.ts) keeps one source of
// truth when it calls createEntityTable(stack.db, taskEntity).
export { taskEntity };

// Both handlers open — demo concern, real feature would gate writes.
const open = { access: { openToAll: true } } as const;

export const taskFeature = defineFeature("tasks", (r) => {
  r.entity("task", taskEntity);
  r.writeHandler(defineEntityWriteHandler("task:create", taskEntity, open));
  r.writeHandler(defineEntityWriteHandler("task:update", taskEntity, open));
  r.writeHandler(defineEntityWriteHandler("task:delete", taskEntity, open));
  r.queryHandler(defineEntityQueryHandler("task:list", taskEntity, open));
  r.queryHandler(defineEntityQueryHandler("task:detail", taskEntity, open));
  r.screen(editScreen);
  r.screen(listScreen);
});
