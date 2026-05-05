// Server-side feature registration. Handler + pipeline wiring lives
// here; the static shape (entity + screens) is imported from
// feature-schema.ts and shared with the client. Splitting the file
// keeps this one's server-only imports (defineFeature,
// defineEntityWriteHandler) out of the browser bundle.

import {
  defineEntityCreateHandler,
  defineEntityDeleteHandler,
  defineEntityDetailHandler,
  defineEntityListHandler,
  defineEntityUpdateHandler,
  defineFeature,
} from "@cosmicdrift/kumiko-framework/engine";
import { editScreen, listScreen, taskEntity } from "./schema";

// Re-export so the server bootstrap (server.ts) keeps one source of
// truth when it calls createEntityTable(stack.db, taskEntity).
export { taskEntity };

// Both handlers open — demo concern, real feature would gate writes.
const open = { access: { openToAll: true } } as const;

export const taskFeature = defineFeature("tasks", (r) => {
  r.entity("task", taskEntity);
  r.writeHandler(defineEntityCreateHandler("task", taskEntity, open));
  r.writeHandler(defineEntityUpdateHandler("task", taskEntity, open));
  r.writeHandler(defineEntityDeleteHandler("task", taskEntity, open));
  r.queryHandler(defineEntityListHandler("task", taskEntity, open));
  r.queryHandler(defineEntityDetailHandler("task", taskEntity, open));
  r.screen(editScreen);
  r.screen(listScreen);
  // Navs auf der Server-Seite registriert damit buildAppSchema sie ins
  // injected window.__KUMIKO_SCHEMA__ packt. NavTree resolved die i18n-
  // Keys über das clientFeature (siehe client.tsx → translations).
  r.nav({ id: "task-list", label: "tasks.nav.list", screen: "task-list", order: 10 });
  r.nav({ id: "task-new", label: "tasks.nav.new", screen: "task-edit", order: 20 });
});
