// kumiko-feature-version: 1
// Demo-Feature für den Designer-Skeleton (C5).
// Enthält bewusst Patterns aus den 3 hand-rollten View-Kategorien:
//   - entity      → Tabelle der Fields
//   - writeHandler → Header + Code-Blocks (schema + handler)
//   - nav         → ID/Label/Screen-Card
// Plus optionalRequires + metric als JSON-Dump-Fallback.

import { defineFeature } from "@kumiko/framework/engine";
import { z } from "zod";

defineFeature("designerDemo", (r) => {
  r.optionalRequires({ features: ["analytics"] });

  r.entity({
    name: "task",
    fields: {
      title: { type: "text", required: true },
      done: { type: "boolean", default: false },
      priority: { type: "select", options: ["low", "medium", "high"], default: "medium" },
    },
  });

  r.writeHandler({
    name: "task:create",
    schema: z.object({ title: z.string(), priority: z.string().optional() }),
    handler: async (_event, _ctx) => {
      return { isSuccess: true, data: { id: "x" } };
    },
    access: { roles: ["user", "admin"] },
  });

  r.writeHandler({
    name: "task:complete",
    schema: z.object({ id: z.string() }),
    handler: async (_event, _ctx) => {
      return { isSuccess: true, data: {} };
    },
    access: { openToAll: true },
  });

  r.nav({
    id: "tasks",
    label: "Tasks",
    screen: "designerDemo:screen:task-list",
  });

  r.metric({ name: "tasks_created", type: "counter" });
});
