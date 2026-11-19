import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";

const AUDIT_EXTENSION = "audit-log";

export const feature = defineFeature("tasks", (r) => {
  // biome-ignore lint/correctness/useHookAtTopLevel: registrar verb, not a React hook
  r.useExtension("tenant-data", "task", { retention: 30 });
  r.useExtension({ name: "soft-delete", entity: "task" });
  r.useExtension(AUDIT_EXTENSION, "task");
  r.useExtension("search", "task", options);
  r.applyExtension({ name: "already-new", entity: "task" });
});
