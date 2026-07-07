import { fetchOne } from "@cosmicdrift/kumiko-framework/bun-db";
import { createEventStoreExecutor } from "@cosmicdrift/kumiko-framework/db";
import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { UnprocessableError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import { z } from "zod";
import { type TenantLifecycleStatus, tenantEntity, tenantTable } from "../../tenant";
import { DESTRUCTION_CANCELLED_EVENT_QN } from "../constants";
import { invalidateTenantLifecycleGate } from "../lifecycle-gate";

const crud = createEventStoreExecutor(tenantTable, tenantEntity, { entityName: "tenant" });

type TenantLifecycleRow = {
  status: TenantLifecycleStatus;
  gracePeriodEnd: Temporal.Instant | null;
};

export const cancelDestructionWrite = defineWriteHandler({
  name: "cancel-destruction",
  schema: z.object({}),
  access: { roles: ["TenantOwner", "Admin"] },
  handler: async (event, ctx) => {
    const tenantId = event.user.tenantId;
    const row = await fetchOne<TenantLifecycleRow>(ctx.db.raw, tenantTable, { id: tenantId });
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

    const gracePeriodEnd = row.gracePeriodEnd;
    const inGrace =
      gracePeriodEnd != null &&
      Temporal.Instant.compare(gracePeriodEnd, getTemporal().Now.instant()) > 0;
    if (!inGrace) {
      return writeFailure(
        new UnprocessableError("grace_period_expired", {
          details: { reason: "grace_period_expired" },
        }),
      );
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

    await ctx.unsafeAppendEvent({
      aggregateId: tenantId,
      aggregateType: "tenant",
      type: DESTRUCTION_CANCELLED_EVENT_QN,
      payload: { cancelledBy: event.user.id },
    });

    return {
      isSuccess: true as const,
      data: {
        tenantId,
        status: "active" as const,
        gracePeriodEnd: null as string | null,
      },
    };
  },
});
