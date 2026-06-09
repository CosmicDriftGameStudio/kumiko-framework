// Minimal row shape accepted by toStoredEvent. Both SelectedEvent
// (event-store) and StoredEventRow (event-dispatcher) satisfy it.
type EventRow = {
  readonly id: bigint;
  readonly aggregateId: string;
  readonly aggregateType: string;
  readonly tenantId: string;
  readonly version: number;
  readonly type: string;
  readonly eventVersion: number;
  readonly payload: Record<string, unknown>;
  readonly metadata: Record<string, unknown>;
  readonly createdAt: Temporal.Instant;
  readonly createdBy: string;
};

export function toStoredEvent(row: EventRow) {
  return {
    id: String(row.id),
    aggregateId: row.aggregateId,
    aggregateType: row.aggregateType,
    tenantId: row.tenantId,
    version: row.version,
    type: row.type,
    eventVersion: row.eventVersion,
    payload: row.payload,
    metadata: row.metadata,
    createdAt: row.createdAt,
    createdBy: row.createdBy,
  };
}
