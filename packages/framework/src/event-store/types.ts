export type EventMetadata = {
  readonly userId: string;
  readonly requestId?: string;
  // End-to-end business-operation id. Root HTTP requests get it from the
  // x-correlation-id header (default: requestId). MSP-applies inherit it
  // from the triggering event. Lets you trace "which user click caused
  // this email 3 streams later?".
  readonly correlationId?: string;
  // Stored event id that triggered this write. Null for root commands;
  // set to event.id when an MSP-apply runs ctx.appendEvent. Together with
  // correlationId forms a causation DAG across aggregate streams.
  readonly causationId?: string;
  // Marten-conform free key/value space for app-specific metadata that
  // doesn't deserve its own EventMetadata field. Examples: A/B-test bucket,
  // feature-flag snapshot, geo-region, client SDK version. Persisted into
  // events.metadata jsonb (no schema change — it's already a free-form
  // jsonb column), survives upcasters untouched, available on every
  // StoredEvent.metadata.headers. Framework does not interpret values; the
  // app reads them when filtering/auditing. Keep values JSON-primitive
  // (string|number|boolean) so JSON serialization stays bulletproof.
  readonly headers?: Readonly<Record<string, string | number | boolean>>;
};
