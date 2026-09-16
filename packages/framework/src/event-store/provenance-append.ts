import { runInSavepointIfSupported } from "../db/query";
import { type TenantDb, unsafeRawForDeclaredStep, withUnsafeRawGrant } from "../db/tenant-db";
import type { TenantId } from "../engine/types";
import { append, type EventMetadata, getStreamVersion } from "./event-store";

// Fixed by the framework, not the caller — the point of this entry point is
// that no caller can invent its own escapeHatch reason for bypassing
// cross-feature event ownership (appendDomainEventCore).
const PROVENANCE_APPEND_REASON =
  "event-store: provenance events append outside the calling feature's ownership — declared once, framework-wide, for provenance streams only.";

export type ProvenanceEventInput = {
  readonly aggregateId: string;
  readonly aggregateType: string;
  readonly tenantId: TenantId;
  readonly expectedVersion: number | "current";
  readonly type: string;
  readonly payload: Record<string, unknown>;
  readonly metadata: EventMetadata;
};

/**
 * The only place enterprise provenance writers (ai-foundation, ai-pipeline)
 * are allowed to reach a raw event-store append — they pass a plain
 * `TenantDb`/`ctx.dbOutsideTransaction`, never a `DbRunner` of their own.
 */
export async function appendProvenanceEvent(
  db: TenantDb,
  event: ProvenanceEventInput,
): Promise<void> {
  const granted = withUnsafeRawGrant(db, { reason: PROVENANCE_APPEND_REASON });
  const runner = unsafeRawForDeclaredStep(granted, PROVENANCE_APPEND_REASON);
  // Bun.SQL/postgres.js abort the whole surrounding begin() on a statement
  // error (25P02) even when the caller's catch swallows it — the savepoint
  // confines that to this scope. Pool connections have no ambient tx to poison.
  await runInSavepointIfSupported(runner, async (sp) => {
    const expectedVersion =
      event.expectedVersion === "current"
        ? await getStreamVersion(sp, event.aggregateId, event.tenantId)
        : event.expectedVersion;
    await append(sp, {
      aggregateId: event.aggregateId,
      aggregateType: event.aggregateType,
      tenantId: event.tenantId,
      expectedVersion,
      type: event.type,
      payload: event.payload,
      metadata: event.metadata,
    });
  });
}
