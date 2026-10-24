import { addDurationSpec } from "@cosmicdrift/kumiko-framework/compliance";
import { createEventStoreExecutor, fetchOne } from "@cosmicdrift/kumiko-framework/db";
import { defineWriteHandler, SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
import { UnprocessableError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import { appendDomainEventCore } from "@cosmicdrift/kumiko-framework/pipeline";
import { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import * as z from "zod";
import { resolveProfileForTenant } from "../../compliance-profiles/index.ts";
import { type TenantLifecycleStatus, tenantEntity, tenantTable } from "../../tenant/index.ts";
import { DESTRUCTION_REQUESTED_EVENT_QN, TENANT_LIFECYCLE_FEATURE } from "../constants.ts";
import { revokeTenantSessions } from "../lib/revoke-tenant-sessions.ts";
import { invalidateTenantLifecycleGate } from "../lifecycle-gate.ts";

const crud = createEventStoreExecutor(tenantTable, tenantEntity, { entityName: "tenant" });

type TenantLifecycleRow = {
  status: TenantLifecycleStatus;
  gracePeriodEnd: Temporal.Instant | null;
};

const REQUEST_DESTRUCTION_TENANT_ROW_REASON =
  "reads the caller's tenant row (a global row on the system tenant), its compliance profile, appends to the tenant stream on the system tenant and revokes its sessions via DbRunner helpers";

export const requestDestructionWrite = defineWriteHandler({
  name: "request-destruction",
  schema: z.object({}),
  access: { roles: ["TenantOwner", "Admin"] },
  description:
    "Puts the caller's own tenant into destroyRequested, starts the compliance-profile grace period after which its data is erased, and revokes every session in the tenant; use it when an account owner asks to close their account.",
  agent: { risk: "high" },
  escapeHatch: {
    grants: ["unsafeRaw"],
    reason: REQUEST_DESTRUCTION_TENANT_ROW_REASON,
  },
  handler: async (event, ctx) => {
    const tenantId = event.user.tenantId;
    const runner = ctx.db.unsafeRaw();
    const row = await fetchOne<TenantLifecycleRow>(runner, tenantTable, { id: tenantId });
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

    const { profile } = await resolveProfileForTenant({ db: runner, tenantId });
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

    await appendDomainEventCore(
      {
        registry: ctx.registry,
        db: runner,
        tenantId: SYSTEM_TENANT_ID,
        userId: String(event.user.id),
        callSiteLabel: "tenant-lifecycle request-destruction",
        callerFeature: TENANT_LIFECYCLE_FEATURE,
      },
      {
        aggregateId: tenantId,
        aggregateType: "tenant",
        type: DESTRUCTION_REQUESTED_EVENT_QN,
        payload: {
          requestedBy: event.user.id,
          gracePeriodEnd: gracePeriodEnd.toString(),
        },
      },
    );

    if (await ctx.hasFeature("sessions")) {
      await revokeTenantSessions(runner, tenantId);
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
