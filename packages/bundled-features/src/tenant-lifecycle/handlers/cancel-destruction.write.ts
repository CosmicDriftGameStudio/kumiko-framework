import { createEventStoreExecutor, fetchOne } from "@cosmicdrift/kumiko-framework/db";
import { defineWriteHandler, SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
import { UnprocessableError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import { appendDomainEventCore } from "@cosmicdrift/kumiko-framework/pipeline";
import * as z from "zod";
import { isWithinGracePeriod } from "../../shared/index.ts";
import { type TenantLifecycleStatus, tenantEntity, tenantTable } from "../../tenant/index.ts";
import { DESTRUCTION_CANCELLED_EVENT_QN, TENANT_LIFECYCLE_FEATURE } from "../constants.ts";
import { invalidateTenantLifecycleGate } from "../lifecycle-gate.ts";

const crud = createEventStoreExecutor(tenantTable, tenantEntity, { entityName: "tenant" });

type TenantLifecycleRow = {
  status: TenantLifecycleStatus;
  gracePeriodEnd: Temporal.Instant | null;
};

const CANCEL_DESTRUCTION_TENANT_ROW_REASON =
  "reads the caller's tenant row (a global row on the system tenant) and appends to the tenant stream on the system tenant";

export const cancelDestructionWrite = defineWriteHandler({
  name: "cancel-destruction",
  schema: z.object({}),
  access: { roles: ["TenantOwner", "Admin"] },
  description:
    "Returns a tenant whose destruction was requested back to active and clears the grace period; use it to undo a close-account request while the grace period is still running.",
  escapeHatch: {
    grants: ["unsafeRaw"],
    reason: CANCEL_DESTRUCTION_TENANT_ROW_REASON,
  },
  handler: async (event, ctx) => {
    const tenantId = event.user.tenantId;
    const runner = ctx.db.unsafeRaw();
    const row = await fetchOne<TenantLifecycleRow>(runner, tenantTable, {
      id: tenantId,
    });
    if (!row) {
      return writeFailure(new UnprocessableError("tenant_not_found", { details: { tenantId } }));
    }
    if (row.status !== "destroyRequested") {
      return writeFailure(
        new UnprocessableError("no_pending_destruction", {
          details: { status: row.status },
        }),
      );
    }

    if (!isWithinGracePeriod(row.gracePeriodEnd)) {
      return writeFailure(new UnprocessableError("grace_period_expired"));
    }

    const update = await crud.update(
      {
        id: tenantId,
        changes: {
          status: "active",
          destroyRequestedAt: null,
          destroyRequestedBy: null,
          gracePeriodEnd: null,
        },
      },
      event.user,
      ctx.db,
      { skipOptimisticLock: true },
    );
    if (!update.isSuccess) return update;
    invalidateTenantLifecycleGate(tenantId);

    await appendDomainEventCore(
      {
        registry: ctx.registry,
        db: runner,
        tenantId: SYSTEM_TENANT_ID,
        userId: String(event.user.id),
        callSiteLabel: "tenant-lifecycle cancel-destruction",
        callerFeature: TENANT_LIFECYCLE_FEATURE,
      },
      {
        aggregateId: tenantId,
        aggregateType: "tenant",
        type: DESTRUCTION_CANCELLED_EVENT_QN,
        payload: { cancelledBy: event.user.id },
      },
    );

    const gracePeriodEnd: string | null = null;
    return {
      isSuccess: true as const,
      data: {
        tenantId,
        status: "active" as const,
        gracePeriodEnd,
      },
    };
  },
});
