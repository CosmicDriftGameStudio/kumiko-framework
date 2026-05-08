import type { DbRunner } from "../db/connection";
import type {
  AppendEventArgs,
  AppendEventFn,
  UnsafeAppendEventFn,
  KumikoEventTypeMap,
  Registry,
  TenantId,
} from "../engine/types";
import { loadAggregate, loadAggregateAsOf, type StoredEvent } from "../event-store/event-store";
import { upcastStoredEvents } from "../event-store/upcaster";
import type { FileContext } from "../files/file-handle";
import { appendDomainEventCore } from "./append-event-core";

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

export type MultiStreamApplyContextDeps = {
  readonly registry: Registry;
  // TX-scoped DbRunner — the same `tx` the applyFn receives as the 2nd
  // arg. ctx.appendEvent + inline-projections run inside this tx so a
  // throw rolls the whole hop back (consumer retries the triggering
  // event on the next pass).
  readonly db: DbRunner;
  // tenantId + userId of the TRIGGERING event. appendEvent stamps these
  // onto the new event so the causal chain stays tenant-consistent and
  // the downstream audit-trail can reconstruct the acting principal.
  readonly tenantId: TenantId;
  readonly userId: string;
  // MSP's owning feature (prefix of its qualified name). Enforced at
  // emit-site: the MSP cannot ctx.appendEvent a type owned by another
  // feature. Cross-feature reactions are fine inbound (this MSP is
  // subscribed to events from any feature), but outbound appends must
  // stay within the MSP's own feature.
  readonly callerFeature?: string;
  // Same FileContext the outer AppContext carries, passed through so
  // MSP applies can reach binaries without another wiring indirection.
  readonly files?: FileContext;
};

export function createMultiStreamApplyContext(
  deps: MultiStreamApplyContextDeps,
): MultiStreamApplyContext {
  return {
    ...(deps.files ? { files: deps.files } : {}),
    // @cast-boundary engine-bridge — concrete impl conforms to AppendEventFn overload
    appendEvent: (async (args: AppendEventArgs) => {
      await appendDomainEventCore(
        {
          registry: deps.registry,
          db: deps.db,
          tenantId: deps.tenantId,
          userId: deps.userId,
          callSiteLabel: "MSP-apply ctx.appendEvent",
          ...(deps.callerFeature && { callerFeature: deps.callerFeature }),
        },
        args,
      );
    }) as AppendEventFn,
    unsafeAppendEvent: async (args) => {
      await appendDomainEventCore(
        {
          registry: deps.registry,
          db: deps.db,
          tenantId: deps.tenantId,
          userId: deps.userId,
          callSiteLabel: "MSP-apply ctx.unsafeAppendEvent",
          ...(deps.callerFeature && { callerFeature: deps.callerFeature }),
        },
        args,
      );
    },

    loadAggregate: async (aggregateId, options) => {
      const events = options?.asOf
        ? await loadAggregateAsOf(deps.db, aggregateId, deps.tenantId, options.asOf)
        : await loadAggregate(deps.db, aggregateId, deps.tenantId);
      return upcastStoredEvents(events, deps.registry.getEventUpcasters(), {
        db: deps.db,
        tenantId: deps.tenantId,
      });
    },
  };
}
