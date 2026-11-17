import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";

export const feature = defineFeature("ext", (r) => {
  r.applyExtension({
    name: "tenant-data",
    entity: "task",
    escapeHatch: { reason: "copies raw rows" },
  });
  r.useExtension("legacy-data", "task", { escapeHatch: { reason: "copies raw rows" } });
});
