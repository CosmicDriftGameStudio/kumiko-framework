// Failure modes of the event-store's append() path. Surfaced as typed
// errors so the executor layer can map them to the framework's
// WriteResult error contract (version_conflict).

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

// Thrown when ctx.appendEvent targets an archived stream. Archived aggregates
// are read-only — restoreStream() makes them writable again. The archive
// state is not carried on the events themselves; it lives on the sparse
// kumiko_archived_streams table. Handlers that need to branch on archive
// state should call ctx.isStreamArchived(id) first.
export class ArchivedStreamError extends Error {
  public readonly tenantId: string;
  public readonly aggregateId: string;
  constructor(tenantId: string, aggregateId: string) {
    super(
      `Aggregate ${aggregateId} on tenant ${tenantId} is archived — appendEvent is blocked. ` +
        `Call restoreStream() to re-open the stream before writing.`,
    );
    this.name = "ArchivedStreamError";
    this.tenantId = tenantId;
    this.aggregateId = aggregateId;
  }
}
