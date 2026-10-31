import {
  defineFeature,
  EXT_EXTERNAL_RESOURCE,
  EXT_INFRA_RESOURCE,
  EXT_SEARCH_ADAPTER,
  EXT_STORAGE_PROVIDER,
  EXT_TENANT_DATA,
  EXT_TENANT_LIFECYCLE_STATUS,
  type FeatureDefinition,
  type TenantLifecycleStatusPlugin,
} from "@cosmicdrift/kumiko-framework/engine";
import { EXT_TENANT_DESTRUCTION_HOLD } from "../shared/index.ts";
import {
  validateTenantDataHookCoverage,
  validateTenantDestroyHookShapes,
  warnIfFilesMountedWithoutTenantData,
} from "./boot-checks.ts";
import {
  DESTRUCTION_CANCELLED_EVENT_SHORT,
  DESTRUCTION_REQUESTED_EVENT_SHORT,
  TENANT_DESTRUCTION_COMPLETED_EVENT_SHORT,
  TENANT_DESTRUCTION_FAILED_EVENT_SHORT,
  TENANT_DESTRUCTION_STAGE_ABANDONED_EVENT_SHORT,
  TENANT_DESTRUCTION_STAGE_FAILED_EVENT_SHORT,
  TENANT_DESTRUCTION_STAGE_PROGRESSED_EVENT_SHORT,
  TENANT_DESTRUCTION_STAGE_STARTED_EVENT_SHORT,
  TENANT_DESTRUCTION_STAGE_SUCCEEDED_EVENT_SHORT,
  TENANT_DESTRUCTION_STARTED_EVENT_SHORT,
} from "./constants.ts";
import {
  destructionCancelledSchema,
  destructionRequestedSchema,
  tenantDestructionCompletedSchema,
  tenantDestructionFailedSchema,
  tenantDestructionStageAbandonedSchema,
  tenantDestructionStageFailedSchema,
  tenantDestructionStageProgressedSchema,
  tenantDestructionStageStartedSchema,
  tenantDestructionStageSucceededSchema,
  tenantDestructionStartedSchema,
} from "./events.ts";
import { cancelDestructionWrite } from "./handlers/cancel-destruction.write.ts";
import { requestDestructionWrite } from "./handlers/request-destruction.write.ts";
import {
  COMPLIANCE_PROFILE_ENTITY_NAME,
  complianceProfileTenantDestroyHook,
  RETENTION_OVERRIDE_ENTITY_NAME,
  retentionOverrideTenantDestroyHook,
} from "./retention-config-destroy-hooks.ts";
import {
  hasTenantDestructionWork,
  resolveTenantLifecycleGate,
  runTenantDestructionSweep,
  tenantDestructionHoldProvider,
} from "./run-tenant-destroy.ts";

const tenantLifecycleStatusPlugin: TenantLifecycleStatusPlugin = {
  async resolveStatus(tenantId, { db }) {
    const gate = await resolveTenantLifecycleGate(db, tenantId);
    return gate ? { status: gate.status } : null;
  },
};

export function createTenantLifecycleFeature(): FeatureDefinition {
  return defineFeature("tenant-lifecycle", (r) => {
    r.describe(
      "Tenant-destroy lifecycle: request/cancel destruction with compliance-profile grace, auth 410 gate for teardown states, cron trigger after grace, and staged destroy runner (extension fan-out, subject-key erase, tenant tombstone).",
    );
    r.uiHints({
      displayLabel: "Tenant Lifecycle · Destroy",
      category: "compliance",
      recommended: false,
    });
    r.requires({ features: ["tenant", "compliance-profiles"] });
    r.optionalRequires("sessions", "data-retention");
    r.usesApi("compliance.forTenant");

    r.extendsRegistrar(EXT_TENANT_DATA, {});
    r.extendsRegistrar(EXT_SEARCH_ADAPTER, {});
    r.extendsRegistrar(EXT_EXTERNAL_RESOURCE, {});
    r.extendsRegistrar(EXT_STORAGE_PROVIDER, {});
    r.extendsRegistrar(EXT_INFRA_RESOURCE, {});

    // Self-extension: data-retention hands a parked tenant back through this, see shared/tenant-destruction-hold.ts.
    r.extendsRegistrar(EXT_TENANT_DESTRUCTION_HOLD, {});
    r.useExtension(EXT_TENANT_DESTRUCTION_HOLD, "tenant-lifecycle", tenantDestructionHoldProvider);

    // Registered here because the hosts of these entities cannot require tenant-lifecycle (cycle,
    // resp. standalone use); the override hook no-ops without data-retention.
    r.useExtension(EXT_TENANT_DATA, COMPLIANCE_PROFILE_ENTITY_NAME, {
      destroy: complianceProfileTenantDestroyHook,
      phase: "tenant-row",
    });
    r.useExtension(EXT_TENANT_DATA, RETENTION_OVERRIDE_ENTITY_NAME, {
      destroy: retentionOverrideTenantDestroyHook,
      phase: "tenant-row",
    });

    // Self-extension, same pattern as `user`/EXT_PRINCIPAL_STATUS — declares
    // AND fulfils tenantLifecycleStatus so teardown state is visible with no per-app wiring.
    r.extendsRegistrar(EXT_TENANT_LIFECYCLE_STATUS, {});
    r.useExtension(EXT_TENANT_LIFECYCLE_STATUS, "tenant-lifecycle", tenantLifecycleStatusPlugin);

    // GDPR-storage guard V4 — moved off the framework-internal
    // boot-validator onto this feature's own r.bootCheck(), since it owns
    // EXT_TENANT_DATA: its own mount is the trigger, matching the original
    // guard's "tenant-lifecycle mounted" gate exactly.
    r.bootCheck(({ features }) => validateTenantDataHookCoverage(features));
    r.bootCheck(({ features }) => validateTenantDestroyHookShapes(features));
    r.bootCheck(({ features }) => warnIfFilesMountedWithoutTenantData(features));

    r.defineEvent(DESTRUCTION_REQUESTED_EVENT_SHORT, destructionRequestedSchema, {
      piiFields: "none",
    });
    r.defineEvent(DESTRUCTION_CANCELLED_EVENT_SHORT, destructionCancelledSchema, {
      piiFields: "none",
    });
    r.defineEvent(TENANT_DESTRUCTION_STARTED_EVENT_SHORT, tenantDestructionStartedSchema, {
      piiFields: "none",
    });
    r.defineEvent(
      TENANT_DESTRUCTION_STAGE_STARTED_EVENT_SHORT,
      tenantDestructionStageStartedSchema,
      {
        piiFields: "none",
      },
    );
    r.defineEvent(
      TENANT_DESTRUCTION_STAGE_SUCCEEDED_EVENT_SHORT,
      tenantDestructionStageSucceededSchema,
      { piiFields: "none" },
    );
    r.defineEvent(
      TENANT_DESTRUCTION_STAGE_PROGRESSED_EVENT_SHORT,
      tenantDestructionStageProgressedSchema,
      { piiFields: "none" },
    );
    r.defineEvent(TENANT_DESTRUCTION_STAGE_FAILED_EVENT_SHORT, tenantDestructionStageFailedSchema, {
      piiFields: "none",
    });
    r.defineEvent(
      TENANT_DESTRUCTION_STAGE_ABANDONED_EVENT_SHORT,
      tenantDestructionStageAbandonedSchema,
      { piiFields: "none" },
    );
    r.defineEvent(TENANT_DESTRUCTION_COMPLETED_EVENT_SHORT, tenantDestructionCompletedSchema, {
      piiFields: "none",
    });
    r.defineEvent(TENANT_DESTRUCTION_FAILED_EVENT_SHORT, tenantDestructionFailedSchema, {
      piiFields: "none",
    });

    r.writeHandler(requestDestructionWrite);
    r.writeHandler(cancelDestructionWrite);

    const RUN_TENANT_DESTRUCTION_REASON = "sweeps tenant destruction across every tenant";
    r.job({
      name: "run-tenant-destruction",
      trigger: { cron: "0 * * * * *", wakesSleepingApp: false },
      concurrency: "skip",
      escapeHatch: { reason: RUN_TENANT_DESTRUCTION_REASON },
      handler: async (_payload, ctx) => {
        if (!ctx.registry) {
          throw new Error("run-tenant-destruction: ctx.registry required (JobContext incomplete)");
        }
        const now = ctx.tz.now();
        // Without crossTenantReads (undeclared hatch) fall through to the sweep.
        if (ctx.crossTenantReads && !(await hasTenantDestructionWork(ctx.crossTenantReads, now))) {
          // skip: no tenant is due, so the sweep would not touch anything
          return;
        }
        await runTenantDestructionSweep({
          db: ctx.db.unsafeRaw() as import("@cosmicdrift/kumiko-framework/db").DbConnection, // @cast-boundary db-operator — jobs never run inside a DbTx
          registry: ctx.registry,
          now,
          log: (message) => ctx.obs.log?.warn(message),
          fileProviderResolver: ctx.services._fileProviderResolver,
          searchAdapter: ctx.services.searchAdapter,
          escapeHatchAuditSink: ctx.services._escapeHatchAuditSink,
          escapeHatchAuditLog: ctx.obs.log,
          actor: ctx.systemUser.id,
        });
      },
    });

    r.exposesApi("tenantLifecycle.runDestroySweep");
  });
}

export {
  TENANT_LIFECYCLE_FEATURE,
  TenantLifecycleHandlers,
} from "./constants.ts";
export { resolveTenantLifecycleGate, runTenantDestructionSweep } from "./run-tenant-destroy.ts";
