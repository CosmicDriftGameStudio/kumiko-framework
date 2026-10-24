import type { TenantId } from "../engine/types/index.ts";
import type { EventMetadata } from "./event-store.ts";

export type RawEventToAppend = {
  readonly aggregateId: string;
  readonly aggregateType: string;
  readonly tenantId: TenantId;
  // Predecessor version. 0 writes a new stream at version 1; > 0 requires
  // the predecessor to exist (same UUID, same tenant). Mirrors EventToAppend.
  readonly expectedVersion: number;
  readonly type: string;
  readonly eventVersion?: number;
  readonly payload: Record<string, unknown>;
  readonly metadata: EventMetadata;
  // Preserves the historical timestamp; it MUST be set and must not default to now().
  readonly createdAt: Temporal.Instant;
  // Preserves the historical actor: a legacy user ID or 'system' for pre-authentication data.
  // Kept separate from metadata.userId because the migration runner uses its own service identity,
  // while the legacy actor identifies the original source.
  readonly createdBy: string;
};
