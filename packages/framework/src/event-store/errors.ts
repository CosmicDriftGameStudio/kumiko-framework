// Two failure modes of the event-store's append() path. Both are surfaced
// as typed errors so the executor layer can map them to the framework's
// WriteResult error contract (version_conflict / idempotency replay).

export class VersionConflictError extends Error {
  public readonly aggregateId: string;
  public readonly expectedVersion: number;
  constructor(aggregateId: string, expectedVersion: number) {
    super(
      `Version conflict on aggregate ${aggregateId}: expected predecessor version ${expectedVersion}`,
    );
    this.name = "VersionConflictError";
    this.aggregateId = aggregateId;
    this.expectedVersion = expectedVersion;
  }
}

// Thrown when an event with the same (tenant, requestId) already exists.
// The command layer catches this, looks up the prior event via
// findEventByRequestId(), and replays the original outcome — callers never
// see this error in a normal idempotent flow.
export class IdempotencyReplayError extends Error {
  public readonly tenantId: string;
  public readonly requestId: string;
  constructor(tenantId: string, requestId: string) {
    super(`Idempotent replay: request ${requestId} already processed for tenant ${tenantId}`);
    this.name = "IdempotencyReplayError";
    this.tenantId = tenantId;
    this.requestId = requestId;
  }
}
