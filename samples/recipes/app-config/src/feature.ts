import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";

export const notesFeature = defineFeature("notes", () => {});

// Stands in for a provider feature that only production mounts (S3, SMTP).
export const auditExportFeature = defineFeature("audit-export", () => {});
