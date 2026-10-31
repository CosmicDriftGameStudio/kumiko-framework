import { addDurationSpec } from "@cosmicdrift/kumiko-framework/compliance";
import {
  createEventStoreExecutor,
  type DbRunner,
  fetchOne,
  type TenantDb,
} from "@cosmicdrift/kumiko-framework/db";
import {
  type Registry,
  type SessionUser,
  SYSTEM_TENANT_ID,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import { UnprocessableError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import { appendDomainEventCore } from "@cosmicdrift/kumiko-framework/pipeline";
import type { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import { resolveProfileForTenant } from "../compliance-profiles/index.ts";
import { type TenantLifecycleStatus, tenantEntity, tenantTable } from "../tenant/index.ts";
import { DESTRUCTION_REQUESTED_EVENT_QN, TENANT_LIFECYCLE_FEATURE } from "./constants.ts";
import { revokeTenantSessions } from "./lib/revoke-tenant-sessions.ts";
import { invalidateTenantLifecycleGate } from "./lifecycle-gate.ts";

const crud = createEventStoreExecutor(tenantTable, tenantEntity, { entityName: "tenant" });

type TenantLifecycleRow = {
  status: TenantLifecycleStatus;
  gracePeriodEnd: Temporal.Instant | null;
};

export type RequestTenantDestructionArgs = {
  readonly tenantId: TenantId;
  readonly actor: SessionUser;
  readonly now: Temporal.Instant;
  readonly db: TenantDb;
  readonly runner: DbRunner;
  readonly registry: Registry;
  readonly revokeSessions: boolean;
};

// Shared by the owner-facing request-destruction handler and by system callers such as
// tenant-inactivity, so both start the same compliance-profile grace period.
export async function requestTenantDestruction(args: RequestTenantDestructionArgs) {
  const { tenantId, actor, now, db, runner, registry } = args;
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
  const gracePeriodEnd = addDurationSpec(now, profile.tenantDestroyGracePeriod);

  const update = await crud.update(
    {
      id: tenantId,
      changes: {
        status: "destroyRequested",
        destroyRequestedAt: now,
        destroyRequestedBy: actor.id,
        gracePeriodEnd,
      },
    },
    actor,
    db,
    { skipOptimisticLock: true },
  );
  if (!update.isSuccess) return update;
  invalidateTenantLifecycleGate(tenantId);

  await appendDomainEventCore(
    {
      registry,
      db: runner,
      tenantId: SYSTEM_TENANT_ID,
      userId: String(actor.id),
      callSiteLabel: "tenant-lifecycle request-destruction",
      callerFeature: TENANT_LIFECYCLE_FEATURE,
    },
    {
      aggregateId: tenantId,
      aggregateType: "tenant",
      type: DESTRUCTION_REQUESTED_EVENT_QN,
      payload: {
        requestedBy: actor.id,
        gracePeriodEnd: gracePeriodEnd.toString(),
      },
    },
  );

  if (args.revokeSessions) {
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
}
