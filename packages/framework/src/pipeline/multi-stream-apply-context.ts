import type { DerivativesContext } from "@cosmicdrift/kumiko-types/derivatives-types";
import type { AppendEventArgs } from "@cosmicdrift/kumiko-types/handlers";
import type { MultiStreamApplyContext } from "@cosmicdrift/kumiko-types/multi-stream-apply-context-types";
import type { SecretsContext } from "@cosmicdrift/kumiko-types/secrets-types";
import type { DbRunner } from "../db/connection.ts";
import type { Registry, TenantId } from "../engine/types/index.ts";

import { loadAggregate, loadAggregateAsOf } from "../event-store/event-store.ts";
import { upcastStoredEvents } from "../event-store/upcaster.ts";
import type { FileContext } from "../files/file-handle.ts";
import { appendDomainEventCore } from "./append-event-core.ts";
import { asTypedAppendEventFn } from "./typed-append-event.ts";

export type { MultiStreamApplyContext } from "@cosmicdrift/kumiko-types/multi-stream-apply-context-types";

export type MultiStreamApplyContextDeps = {
  readonly registry: Registry;
  // Same DbRunner the applyFn receives as its 2nd arg. In the server's MSP
  // consumer wiring (api/server.ts) that's the unbound pool, not the
  // dispatcher's cursor tx — a throw does NOT roll back appends/inline
  // projections already made; apply must be idempotent for the retry.
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
  // Same DerivativesContext the outer AppContext carries — mirrors `files`.
  readonly derivatives?: DerivativesContext;
  // Same SecretsContext the outer AppContext carries, mirrors `files`.
  readonly secrets?: SecretsContext;
  readonly jobs?: MultiStreamApplyContext["jobs"];
};

export function createMultiStreamApplyContext(
  deps: MultiStreamApplyContextDeps,
): MultiStreamApplyContext {
  return {
    registry: deps.registry,
    ...(deps.files ? { files: deps.files } : {}),
    ...(deps.derivatives ? { derivatives: deps.derivatives } : {}),
    ...(deps.secrets ? { secrets: deps.secrets } : {}),
    ...(deps.jobs ? { jobs: deps.jobs } : {}),
    appendEvent: asTypedAppendEventFn(async (args: AppendEventArgs) => {
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
    }),
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
