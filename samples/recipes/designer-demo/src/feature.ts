// kumiko-feature-version: 1
// Demo feature for the designer skeleton (C5).
// Deliberately contains patterns from the 3 hand-rolled view categories:
//   - entity      → table of fields
//   - writeHandler → header + code blocks (schema + handler)
//   - nav         → ID/label/screen card
// Plus optionalRequires + metric as a JSON dump fallback.

import { createTextField, defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";

defineFeature("designerDemo", (r) => {
  r.optionalRequires("analytics");

  r.entity({
    name: "task",
    fields: {
      title: createTextField({
        required: true,
        personal: false,
        reason: "demo_task_title_is_not_personal_data",
      }),
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
    access: {
      openToAll: {
        reason:
          "sample handler: any signed-in user may complete a task in this designer-skeleton " +
          "demo; there is no per-user task ownership",
      },
    },
  });

  r.nav({
    id: "tasks",
    label: "Tasks",
    icon: "list",
    screen: "designerDemo:screen:task-list",
  });

  r.metric("tasks_created", { type: "counter" });
});
