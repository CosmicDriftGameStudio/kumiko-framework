import type { TenantDb } from "@cosmicdrift/kumiko-types/tenant-db-types";
import { tenantDbRunner } from "../db/tenant-db-runner.js";
import type { Registry } from "../engine/types/index.js";
import { runProjectionsForEvent } from "../pipeline/projections-runner.js";
import { append, type EventToAppend, getStreamVersion, type StoredEvent } from "./event-store.js";

export type AppendEventInTenantDbOptions = {
  // Runs the inline projections of the appended event on the same runner, so a projection row
  // commits or rolls back together with the event.
  readonly registry?: Registry;
};

// Appends on the connection or transaction the TenantDb is bound to. The tenant is always the
// TenantDb's own, so a caller cannot write into another tenant's stream; a TenantDb the framework
// did not build (or a fail-closed systemScope guard) is rejected by tenantDbRunner.
export async function appendEventInTenantDb(
  tenantDb: TenantDb,
  event: Omit<EventToAppend, "tenantId">,
  options: AppendEventInTenantDbOptions = {},
): Promise<StoredEvent> {
  const runner = tenantDbRunner(tenantDb);
  const stored = await append(runner, { ...event, tenantId: tenantDb.tenantId });
  if (options.registry) await runProjectionsForEvent(stored, options.registry, runner);
  return stored;
}

export async function getStreamVersionInTenantDb(
  tenantDb: TenantDb,
  aggregateId: string,
): Promise<number> {
  return getStreamVersion(tenantDbRunner(tenantDb), aggregateId, tenantDb.tenantId);
}
