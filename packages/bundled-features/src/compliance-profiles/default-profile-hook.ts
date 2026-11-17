import type { SELECTABLE_PROFILE_KEYS } from "@cosmicdrift/kumiko-framework/compliance";
import { createEventStoreExecutor } from "@cosmicdrift/kumiko-framework/db";
import type { FeatureRegistrar } from "@cosmicdrift/kumiko-framework/engine";
import { InternalError } from "@cosmicdrift/kumiko-framework/errors";
import { registerTenantCreatedSeedHook } from "../shared/tenant-created-seed-hook.ts";
import {
  tenantComplianceProfileEntity,
  tenantComplianceProfileTable,
} from "./schema/profile-selection.ts";

export type DefaultComplianceProfileKey = (typeof SELECTABLE_PROFILE_KEYS)[number];

const executor = createEventStoreExecutor(
  tenantComplianceProfileTable,
  tenantComplianceProfileEntity,
  { entityName: "tenant-compliance-profile" },
);

export function registerDefaultProfileHook(
  r: FeatureRegistrar,
  profileKey: DefaultComplianceProfileKey,
): void {
  registerTenantCreatedSeedHook(r, {
    reason: "seeds the default compliance profile of the tenant just created",
    seed: async ({ tenantId, tenantDb, systemUser }) => {
      const created = await executor.create(
        { profileKey, override: null, tenantId },
        systemUser,
        tenantDb,
      );
      if (!created.isSuccess) {
        throw new InternalError({
          message: `default compliance profile for tenant ${tenantId} failed: ${created.error.code}`,
        });
      }
    },
  });
}
