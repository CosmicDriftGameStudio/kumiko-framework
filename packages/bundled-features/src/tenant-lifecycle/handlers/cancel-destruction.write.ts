import { fetchOne } from "@cosmicdrift/kumiko-framework/bun-db";
import { createEventStoreExecutor } from "@cosmicdrift/kumiko-framework/db";
import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { UnprocessableError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
// Value-only import, aliased to avoid shadowing the ambient global
// `Temporal` TYPE that TenantLifecycleRow.gracePeriodEnd resolves against
// (same #1438 dual-package-hazard pattern as event-store.ts).
import { Temporal as TemporalPolyfill } from "temporal-polyfill";
import { z } from "zod";
import { type TenantLifecycleStatus, tenantEntity, tenantTable } from "../../tenant";
import { DESTRUCTION_CANCELLED_EVENT_QN } from "../constants";
import { invalidateTenantLifecycleGate } from "../lifecycle-gate";

const crud = createEventStoreExecutor(tenantTable, tenantEntity, { entityName: "tenant" });

type TenantLifecycleRow = {
  status: TenantLifecycleStatus;
  gracePeriodEnd: InstanceType<typeof TemporalPolyfill.Instant> | null;
};

// kumiko-framework#1525: exported so the ambient-global-independence
// regression test can call it directly — the handler itself has no seam
// short of a full dispatcher round-trip (which would also delete the
// ambient global out from under buildHandlerContext's unrelated ctx.tz
// setup, unrelated to this fix).
export function isWithinGracePeriod(gracePeriodEnd: InstanceType<typeof TemporalPolyfill.Instant> | null): boolean {
  // @cast-boundary temporal-polyfill-vs-ambient: same TC39 Temporal.Instant
  // at runtime — gracePeriodEnd is DB-row-typed against the ambient
  // global, two distinct nominal types across the two .d.ts sources (see
  // event-store.ts).
  return (
    gracePeriodEnd != null &&
    TemporalPolyfill.Instant.compare(
      gracePeriodEnd,
      TemporalPolyfill.Now.instant(),
    ) > 0
  );
}

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

    if (!isWithinGracePeriod(row.gracePeriodEnd)) {
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
