import type { DbRunner } from "../db/connection";
import type { AppendEventArgs, Registry, TenantId } from "../engine/types";
import {
  loadAggregate,
  loadAggregateAsOf,
  type StoredEvent,
} from "../event-store/event-store";
import { upcastStoredEvents } from "../event-store/upcaster";
import { appendDomainEventCore } from "./append-event-core";

// Minimal, read+write surface handed to a MultiStreamProjection's apply()
// when it needs to produce follow-up events (saga / process-manager
// pattern). Keeps the MSP feature-decoupled: applies don't reach into
// handler-bridge (no query/write/writeAs), they just read the aggregate
// stream and append new events — Marten's session scope for projections.
export type MultiStreamApplyContext = {
  // Append a domain event onto an aggregate stream in the CURRENT tx.
  // Schema-validated, archive-guarded, stream-version derived. Metadata
  // inherits from the triggering event (correlationId) + requestContext
  // (causationId is already set to the triggering event.id by the
  // dispatcher wrap).
  readonly appendEvent: (args: AppendEventArgs) => Promise<void>;
  // Read an aggregate stream — useful when a saga needs to inspect the
  // current state of a different aggregate before deciding what to emit.
  readonly loadAggregate: (
    aggregateId: string,
    options?: { readonly asOf?: Date },
  ) => Promise<readonly StoredEvent[]>;
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
};

export function createMultiStreamApplyContext(deps: MultiStreamApplyContextDeps): MultiStreamApplyContext {
  return {
    appendEvent: async (args) => {
      await appendDomainEventCore(
        {
          registry: deps.registry,
          db: deps.db,
          tenantId: deps.tenantId,
          userId: deps.userId,
          callSiteLabel: "MSP-apply ctx.appendEvent",
        },
        args,
      );
    },

    loadAggregate: async (aggregateId, options) => {
      const events = options?.asOf
        ? await loadAggregateAsOf(deps.db, aggregateId, deps.tenantId, options.asOf)
        : await loadAggregate(deps.db, aggregateId, deps.tenantId);
      return upcastStoredEvents(events, deps.registry.getEventUpcasters());
    },
  };
}
