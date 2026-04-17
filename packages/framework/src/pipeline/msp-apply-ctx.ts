import { requestContext } from "../api/request-context";
import type { DbRunner } from "../db/connection";
import type { AppendEventArgs, Registry, TenantId } from "../engine/types";
import { InternalError, validationErrorFromZod } from "../errors";
import { isStreamArchived } from "../event-store/archive";
import { ArchivedStreamError } from "../event-store/errors";
import {
  append,
  getStreamVersion,
  loadAggregate,
  loadAggregateAsOf,
  type StoredEvent,
} from "../event-store/event-store";
import { upcastStoredEvents } from "../event-store/upcaster";
import { runProjectionsForEvent } from "./projections-runner";

// Minimal, read+write surface handed to a MultiStreamProjection's apply()
// when it needs to produce follow-up events (saga / process-manager
// pattern). Keeps the MSP feature-decoupled: applies don't reach into
// handler-bridge (no query/write/writeAs), they just read the aggregate
// stream and append new events — Marten's session scope for projections.
export type MspApplyContext = {
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

export type MspApplyContextDeps = {
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

export function createMspApplyContext(deps: MspApplyContextDeps): MspApplyContext {
  return {
    appendEvent: async (args) => {
      const eventDef = deps.registry.getEvent(args.type);
      if (!eventDef) {
        throw new InternalError({
          message: `ctx.appendEvent("${args.type}") in MSP-apply — event not registered. Call r.defineEvent(shortName, schema) in a feature; appendEvent expects the qualified name returned by defineEvent.`,
        });
      }
      const parsed = eventDef.schema.safeParse(args.payload ?? {});
      if (!parsed.success) throw validationErrorFromZod(parsed.error);
      const validatedPayload = parsed.data as Record<string, unknown>;

      if (await isStreamArchived(deps.db, deps.tenantId, args.aggregateId)) {
        throw new ArchivedStreamError(deps.tenantId, args.aggregateId);
      }

      const expectedVersion = await getStreamVersion(
        deps.db,
        args.aggregateId,
        deps.tenantId,
      );

      const reqCtx = requestContext.get();
      // Same stamp-once-only semantics as dispatcher.appendDomainEvent:
      // events_idempotency_idx is UNIQUE on (tenantId, metadata->>'requestId'),
      // so only the FIRST event in a request wears the marker.
      const stampRequestId = reqCtx?.requestId && !reqCtx.requestIdUsed;

      const stored = await append(deps.db, {
        aggregateId: args.aggregateId,
        aggregateType: args.aggregateType,
        tenantId: deps.tenantId,
        expectedVersion,
        type: args.type,
        eventVersion: eventDef.version,
        payload: validatedPayload,
        metadata: {
          userId: deps.userId,
          ...(stampRequestId && reqCtx ? { requestId: reqCtx.requestId } : {}),
          ...(reqCtx?.correlationId ? { correlationId: reqCtx.correlationId } : {}),
          ...(reqCtx?.causationId ? { causationId: reqCtx.causationId } : {}),
        },
      });
      if (stampRequestId && reqCtx) reqCtx.requestIdUsed = true;

      // Inline projections fire in the same tx — same semantics as
      // ctx.appendEvent from a write-handler. Consistency: whether an
      // event lands via write-handler or MSP-apply, its inline
      // projections fire in the same transaction.
      await runProjectionsForEvent(stored, deps.registry, deps.db);
    },

    loadAggregate: async (aggregateId, options) => {
      const events = options?.asOf
        ? await loadAggregateAsOf(deps.db, aggregateId, deps.tenantId, options.asOf)
        : await loadAggregate(deps.db, aggregateId, deps.tenantId);
      return upcastStoredEvents(events, deps.registry.getEventUpcasters());
    },
  };
}
