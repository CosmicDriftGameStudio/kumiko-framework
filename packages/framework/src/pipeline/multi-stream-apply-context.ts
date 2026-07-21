import type { MultiStreamApplyContext } from "@cosmicdrift/kumiko-types/multi-stream-apply-context-types";
import type { DbRunner } from "../db/connection";
import type { AppendEventArgs, AppendEventFn, Registry, TenantId } from "../engine/types";
import { loadAggregate, loadAggregateAsOf } from "../event-store/event-store";
import { upcastStoredEvents } from "../event-store/upcaster";
import type { FileContext } from "../files/file-handle";
import { appendDomainEventCore } from "./append-event-core";

export type { MultiStreamApplyContext } from "@cosmicdrift/kumiko-types/multi-stream-apply-context-types";

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
    }) as AppendEventFn, // @cast-boundary engine-bridge
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
