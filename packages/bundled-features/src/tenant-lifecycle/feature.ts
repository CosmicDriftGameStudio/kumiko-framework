import {
  defineFeature,
  EXT_EXTERNAL_RESOURCE,
  EXT_INFRA_RESOURCE,
  EXT_SEARCH_ADAPTER,
  EXT_STORAGE_PROVIDER,
  EXT_TENANT_DATA,
  type FeatureDefinition,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  DESTRUCTION_CANCELLED_EVENT_SHORT,
  DESTRUCTION_REQUESTED_EVENT_SHORT,
  TENANT_DESTRUCTION_COMPLETED_EVENT_SHORT,
  TENANT_DESTRUCTION_FAILED_EVENT_SHORT,
  TENANT_DESTRUCTION_STAGE_ABANDONED_EVENT_SHORT,
  TENANT_DESTRUCTION_STAGE_FAILED_EVENT_SHORT,
  TENANT_DESTRUCTION_STAGE_STARTED_EVENT_SHORT,
  TENANT_DESTRUCTION_STAGE_SUCCEEDED_EVENT_SHORT,
  TENANT_DESTRUCTION_STARTED_EVENT_SHORT,
} from "./constants";
import {
  destructionCancelledSchema,
  destructionRequestedSchema,
  tenantDestructionCompletedSchema,
  tenantDestructionFailedSchema,
  tenantDestructionStageAbandonedSchema,
  tenantDestructionStageFailedSchema,
  tenantDestructionStageStartedSchema,
  tenantDestructionStageSucceededSchema,
  tenantDestructionStartedSchema,
} from "./events";
import { cancelDestructionWrite } from "./handlers/cancel-destruction.write";
import { requestDestructionWrite } from "./handlers/request-destruction.write";
import { runTenantDestructionSweep } from "./run-tenant-destroy";

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
    r.requires("tenant", "compliance-profiles");
    r.optionalRequires("sessions");
    r.usesApi("compliance.forTenant");

    r.extendsRegistrar(EXT_TENANT_DATA, {});
    r.extendsRegistrar(EXT_SEARCH_ADAPTER, {});
    r.extendsRegistrar(EXT_EXTERNAL_RESOURCE, {});
    r.extendsRegistrar(EXT_STORAGE_PROVIDER, {});
    r.extendsRegistrar(EXT_INFRA_RESOURCE, {});

    r.defineEvent(DESTRUCTION_REQUESTED_EVENT_SHORT, destructionRequestedSchema);
    r.defineEvent(DESTRUCTION_CANCELLED_EVENT_SHORT, destructionCancelledSchema);
    r.defineEvent(TENANT_DESTRUCTION_STARTED_EVENT_SHORT, tenantDestructionStartedSchema);
    r.defineEvent(
      TENANT_DESTRUCTION_STAGE_STARTED_EVENT_SHORT,
      tenantDestructionStageStartedSchema,
    );
    r.defineEvent(
      TENANT_DESTRUCTION_STAGE_SUCCEEDED_EVENT_SHORT,
      tenantDestructionStageSucceededSchema,
    );
    r.defineEvent(TENANT_DESTRUCTION_STAGE_FAILED_EVENT_SHORT, tenantDestructionStageFailedSchema);
    r.defineEvent(
      TENANT_DESTRUCTION_STAGE_ABANDONED_EVENT_SHORT,
      tenantDestructionStageAbandonedSchema,
    );
    r.defineEvent(TENANT_DESTRUCTION_COMPLETED_EVENT_SHORT, tenantDestructionCompletedSchema);
    r.defineEvent(TENANT_DESTRUCTION_FAILED_EVENT_SHORT, tenantDestructionFailedSchema);

    r.writeHandler(requestDestructionWrite);
    r.writeHandler(cancelDestructionWrite);

    r.job(
      "run-tenant-destruction",
      { trigger: { cron: "0 * * * * *" }, concurrency: "skip" },
      async (_payload, ctx) => {
        if (!ctx.db || !ctx.registry) {
          throw new Error(
            "run-tenant-destruction: ctx.db + ctx.registry required (JobContext incomplete)",
          );
        }
        const T = (await import("@cosmicdrift/kumiko-framework/time")).getTemporal();
        await runTenantDestructionSweep({
          db: ctx.db as import("@cosmicdrift/kumiko-framework/db").DbConnection,
          registry: ctx.registry,
          now: T.Now.instant(),
          log: (message) => ctx.log?.warn(message),
        });
      },
    );

    r.exposesApi("tenantLifecycle.runDestroySweep");
  });
}

export {
  TENANT_LIFECYCLE_FEATURE,
  TenantLifecycleHandlers,
} from "./constants";
export { resolveTenantLifecycleGate, runTenantDestructionSweep } from "./run-tenant-destroy";
