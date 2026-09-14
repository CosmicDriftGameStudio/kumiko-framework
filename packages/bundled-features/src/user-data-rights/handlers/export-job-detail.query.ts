import { access, defineEntityDetailHandler } from "@cosmicdrift/kumiko-framework/engine";
import { exportJobEntity } from "../schema/export-job";

// Detail fetch backing the read-only export-job inspector screen.
export const exportJobDetailQuery = defineEntityDetailHandler("export-job", exportJobEntity, {
  access: { roles: access.systemAdmin },
  escapeHatch: {
    reason:
      "SystemAdmin GDPR Art. 20 export inspector opens one data-export job owned by any tenant for platform-operator support",
  },
  description:
    "Read-only cross-tenant detail view of one GDPR data-export job for the system-admin inspector, showing its lifecycle timestamps, storage key, byte count and error message.",
});
