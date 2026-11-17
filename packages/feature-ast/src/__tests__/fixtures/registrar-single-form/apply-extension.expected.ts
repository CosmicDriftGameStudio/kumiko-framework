import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";

const AUDIT_EXTENSION = "audit-log";

export const feature = defineFeature("tasks", (r) => {
  r.applyExtension({ name: "tenant-data", entity: "task", retention: 30 });
  r.applyExtension({ name: "soft-delete", entity: "task" });
  r.applyExtension({ name: AUDIT_EXTENSION, entity: "task" });
  r.applyExtension({ name: "search", entity: "task", ...options });
  r.applyExtension({ name: "already-new", entity: "task" });
});
