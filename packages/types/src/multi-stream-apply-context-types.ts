import type { StoredEvent } from "./event-store-types";
import type { KumikoEventTypeMap } from "./event-type-map";
import type { FileContext } from "./file-handle-types";
import type { AppendEventFn, UnsafeAppendEventFn } from "./handlers";

// Minimal, read+write surface handed to a MultiStreamProjection's apply()
// when it needs to produce follow-up events (saga / process-manager
// pattern). Keeps the MSP feature-decoupled: applies don't reach into
// handler-bridge (no query/write/writeAs), they just read the aggregate
// stream and append new events — Marten's session scope for projections.
//
// TMap propagates the strict event-type-map (see HandlerContext). Default
// matches the global KumikoEventTypeMap; runtime-pluggable callers route
// through unsafeAppendEvent.
export type MultiStreamApplyContext<TMap extends object = KumikoEventTypeMap> = {
  // Append a domain event onto an aggregate stream in the CURRENT tx.
  // Schema-validated, archive-guarded, stream-version derived. Metadata
  // inherits from the triggering event (correlationId) + requestContext
  // (causationId is already set to the triggering event.id by the
  // dispatcher wrap). Strict against KumikoEventTypeMap — same contract
  // as HandlerContext.appendEvent (compile-time-validated payload).
  readonly appendEvent: AppendEventFn<TMap>;
  // Escape hatch for runtime-pluggable events without compile-time
  // augmentation. Same runtime semantics; type-surface is `payload: unknown`.
  readonly unsafeAppendEvent: UnsafeAppendEventFn;
  // Read an aggregate stream — useful when a saga needs to inspect the
  // current state of a different aggregate before deciding what to emit.
  readonly loadAggregate: (
    aggregateId: string,
    options?: { readonly asOf?: Temporal.Instant },
  ) => Promise<readonly StoredEvent[]>;
  // Binary storage handle factory, mirrors AppContext.files. Present when
  // the app booted with `files.storageProvider`; undefined otherwise.
  // Post-processing MSPs (resize, EXIF-strip, virus-scan) read bytes via
  // `ctx.files.ref(payload.storageKey).read()` and write derivates via
  // `.derive("thumb").write(...)` — binaries never ride through events.
  readonly files?: FileContext;
};
