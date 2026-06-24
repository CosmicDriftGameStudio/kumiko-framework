import { access, defineEntityListHandler } from "@cosmicdrift/kumiko-framework/engine";
import { exportJobEntity } from "../schema/export-job";

// SystemAdmin operator view of GDPR Art. 20 export jobs. Read-only inspector —
// rows are created by the user's request-export flow, never through this handler.
export const exportJobListQuery = defineEntityListHandler("export-job", exportJobEntity, {
  access: { roles: access.systemAdmin },
});
