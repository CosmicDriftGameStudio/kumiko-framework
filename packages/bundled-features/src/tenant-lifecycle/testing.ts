import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import { SYSTEM_TENANT_ID, type TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { append, loadAggregate } from "@cosmicdrift/kumiko-framework/event-store";
import type { SearchAdapter } from "@cosmicdrift/kumiko-framework/search";
import { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import { updateRowViaEventStore } from "@cosmicdrift/kumiko-testing/helpers";
import type { TestStack } from "@cosmicdrift/kumiko-testing/stack";
import { tenantEntity, tenantTable } from "../tenant/index.ts";
import { TENANT_AGGREGATE_TYPE, TENANT_DESTRUCTION_STARTED_EVENT_QN } from "./constants.ts";
import { runTenantDestructionSweep } from "./run-tenant-destroy.ts";

// Sidesteps the `request-destruction` write handler (needs user/auth/sessions
// features wired) by seeding the same "destroying" state it would produce.
export async function seedDestroyingTenant(db: DbConnection, tenantId: TenantId): Promise<void> {
  const now = getTemporal().Now.instant();
  await updateRowViaEventStore(
    db,
    { table: tenantTable, entity: tenantEntity, entityName: "tenant" },
    { id: tenantId },
    { status: "destroying", destroyStartedAt: now },
    { tenantId: SYSTEM_TENANT_ID },
  );
  await append(db, {
    aggregateId: tenantId,
    aggregateType: TENANT_AGGREGATE_TYPE,
    tenantId: SYSTEM_TENANT_ID,
    expectedVersion: (await loadAggregate(db, tenantId, SYSTEM_TENANT_ID)).at(-1)?.version ?? 0,
    type: TENANT_DESTRUCTION_STARTED_EVENT_QN,
    payload: { startedAt: now.toString() },
    metadata: { userId: "system", requestId: "test:destruction-started" },
  });
}

export async function driveDestructionToCompletion(
  stack: TestStack,
  db: DbConnection,
  tenantId: TenantId,
  searchAdapter?: SearchAdapter,
): Promise<string> {
  const farFuture = getTemporal()
    .Now.instant()
    .add({ hours: 24 * 3650 });
  let status = "";
  for (let i = 0; i < 20; i++) {
    await runTenantDestructionSweep({
      db: stack.db,
      registry: stack.registry,
      now: farFuture,
      searchAdapter,
    });
    const rows = await selectMany(db, tenantTable, { id: tenantId });
    status = String(rows[0]?.["status"]);
    if (status === "destroyed" || status === "destroyFailed") break;
  }
  return status;
}

export { runTenantDestructionSweep };
