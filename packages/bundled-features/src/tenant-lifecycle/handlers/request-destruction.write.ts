import { fetchOne } from "@cosmicdrift/kumiko-framework/bun-db";
import { addDurationSpec } from "@cosmicdrift/kumiko-framework/compliance";
import { createEventStoreExecutor } from "@cosmicdrift/kumiko-framework/db";
import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { UnprocessableError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import { z } from "zod";
import { resolveProfileForTenant } from "../../compliance-profiles";
import { type TenantLifecycleStatus, tenantEntity, tenantTable } from "../../tenant";
import { DESTRUCTION_REQUESTED_EVENT_QN } from "../constants";
import { revokeTenantSessions } from "../lib/revoke-tenant-sessions";
import { invalidateTenantLifecycleGate } from "../lifecycle-gate";

const crud = createEventStoreExecutor(tenantTable, tenantEntity, { entityName: "tenant" });

type TenantLifecycleRow = {
  status: TenantLifecycleStatus;
  gracePeriodEnd: Temporal.Instant | null;
};

export const requestDestructionWrite = defineWriteHandler({
  name: "request-destruction",
  schema: z.object({}),
  access: { roles: ["TenantOwner", "Admin"] },
  handler: async (event, ctx) => {
    const tenantId = event.user.tenantId;
    const row = await fetchOne<TenantLifecycleRow>(ctx.db.raw, tenantTable, { id: tenantId });
    if (!row) {
      return writeFailure(new UnprocessableError("tenant_not_found", { details: { tenantId } }));
    }
    if (row.status !== "active") {
      return writeFailure(
        new UnprocessableError("tenant_not_active", {
          details: { status: row.status },
        }),
      );
    }

    const { profile } = await resolveProfileForTenant({ db: ctx.db.raw, tenantId });
    const T = getTemporal();
    const gracePeriodEnd = addDurationSpec(T.Now.instant(), profile.tenantDestroyGracePeriod);

    const update = await crud.update(
      {
        id: tenantId,
        changes: {
          status: "destroyRequested",
          destroyRequestedAt: T.Now.instant(),
          destroyRequestedBy: event.user.id,
          gracePeriodEnd,
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
      type: DESTRUCTION_REQUESTED_EVENT_QN,
      payload: {
        requestedBy: event.user.id,
        gracePeriodEnd: gracePeriodEnd.toString(),
      },
    });

    if (ctx.hasFeature("sessions")) {
      await revokeTenantSessions(ctx.db.raw, tenantId);
    }

    return {
      isSuccess: true as const,
      data: {
        tenantId,
        status: "destroyRequested" as const,
        gracePeriodEnd: gracePeriodEnd.toString(),
      },
    };
  },
});
