import { access, defineEntityListHandler } from "@cosmicdrift/kumiko-framework/engine";
import { exportJobEntity } from "../schema/export-job";

// SystemAdmin operator view of GDPR Art. 20 export jobs. Read-only inspector —
// rows are created by the user's request-export flow, never through this handler.
export const exportJobListQuery = defineEntityListHandler("export-job", exportJobEntity, {
  access: { roles: access.systemAdmin },
  crossTenant: true,
  description:
    "Read-only cross-tenant list of GDPR Art. 20 data-export jobs for the system-admin inspector; use export-status instead when a user asks about their own export.",
});
