import { runInSavepointIfSupported } from "../db/query";
import { type TenantDb, unsafeRawForDeclaredStep, withUnsafeRawGrant } from "../db/tenant-db";
import type { TenantId } from "../engine/types";
import { AccessDeniedError, InternalError } from "../errors";
import { SYSTEM_EVENT_PREFIX } from "../pipeline/append-event-core";
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

// The only place provenance writers are allowed to reach a raw event-store append.
export async function appendProvenanceEvent(
  db: TenantDb,
  event: ProvenanceEventInput,
): Promise<void> {
  if (event.type.startsWith(SYSTEM_EVENT_PREFIX)) {
    throw new InternalError({
      message: `appendProvenanceEvent("${event.type}") — the "${SYSTEM_EVENT_PREFIX}" namespace is framework-internal and is not reachable through this entry point.`,
    });
  }
  if (!event.type.includes(":")) {
    throw new InternalError({
      message: `appendProvenanceEvent("${event.type}") — event types must be owner-qualified ("<feature>:<name>"). Unowned types are not allowed here.`,
    });
  }
  const granted = withUnsafeRawGrant(db, { reason: PROVENANCE_APPEND_REASON });
  const runner = unsafeRawForDeclaredStep(granted, PROVENANCE_APPEND_REASON);
  // Unconditional, including mode "system": crossTenantRebinders keeps the
  // original tenantId and only flips the mode, so a system-scoped db must not
  // append for a foreign tenant either.
  if (event.tenantId !== db.tenantId) {
    throw new AccessDeniedError({
      message: `appendProvenanceEvent: event tenant "${event.tenantId}" does not match the TenantDb's tenant "${db.tenantId}".`,
    });
  }
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
