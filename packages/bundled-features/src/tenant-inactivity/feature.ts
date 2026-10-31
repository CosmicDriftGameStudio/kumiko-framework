import { deleteMany, deriveEntityTableMeta } from "@cosmicdrift/kumiko-framework/db";
import {
  defineFeature,
  EXT_TENANT_DATA,
  type FeatureDefinition,
  type TenantDataDestroyHook,
} from "@cosmicdrift/kumiko-framework/engine";
import { checkTenantInactivity } from "./check-inactive-tenants.ts";
import { TENANT_INACTIVITY_FEATURE, TENANT_INACTIVITY_STATE_ENTITY } from "./constants.ts";
import { createInactivityStateQuery } from "./handlers/inactivity-state.query.ts";
import { createKeepAccountHandler } from "./handlers/keep-account.write.ts";
import { registerInactivityMails } from "./mail-notifications.ts";
import type { TenantInactivityOptions } from "./options.ts";
import { tenantInactivityStateEntity, tenantInactivityStateTable } from "./state-table.ts";

const CHECK_JOB_ESCAPE_HATCH_REASON =
  "reads the tenant's lifecycle status on the system tenant and files the deletion request through the shared tenant-lifecycle core, which writes the tenant row and its event stream with a raw runner";

const tenantInactivityStateDestroyHook: TenantDataDestroyHook = async (ctx) => {
  await deleteMany(ctx.db, tenantInactivityStateTable, { tenantId: ctx.tenantId });
};

/**
 * Opt-in by mounting. Free accounts without activity get warning mails, then a normal deletion
 * request through tenant-lifecycle; paid tiers are exempt. The option value carries functions
 * (rules per tier, activity sources), so the feature is never deduplicated by options.
 */
export function createTenantInactivityFeature<TTier extends string = string>(
  options: TenantInactivityOptions<TTier>,
): FeatureDefinition {
  return defineFeature(TENANT_INACTIVITY_FEATURE, (r) => {
    r.describe(
      "Deletes abandoned free accounts: warns the tenant owners before the deadline, then files the regular tenant-lifecycle deletion request. Activity or the keep-account link restarts the period; tiers without a rule are exempt.",
    );
    r.uiHints({
      displayLabel: "Tenant Inactivity · Deletion",
      category: "compliance",
      recommended: false,
    });
    r.requires({ features: ["sessions", "tenant", "tenant-lifecycle", "delivery"] });

    r.storeTable(
      deriveEntityTableMeta(TENANT_INACTIVITY_STATE_ENTITY, tenantInactivityStateEntity, {
        source: "unmanaged",
      }),
      { reason: "read_side.tenant_inactivity_state_direct_write" },
    );
    r.useExtension(EXT_TENANT_DATA, TENANT_INACTIVITY_STATE_ENTITY, {
      destroy: tenantInactivityStateDestroyHook,
    });

    registerInactivityMails(r);

    r.job({
      name: "check-inactive-tenants",
      trigger: { maintenance: true, wakesSleepingApp: false },
      perTenant: true,
      concurrency: "skip",
      escapeHatch: { grants: ["unsafeRaw"], reason: CHECK_JOB_ESCAPE_HATCH_REASON },
      handler: async (_payload, ctx) => checkTenantInactivity(ctx, options),
    });

    r.writeHandler(createKeepAccountHandler(options));
    r.queryHandler(createInactivityStateQuery(options));
  });
}
