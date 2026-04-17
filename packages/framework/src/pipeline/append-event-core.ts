import { requestContext } from "../api/request-context";
import type { DbRunner } from "../db/connection";
import type { AppendEventArgs, Registry, TenantId } from "../engine/types";
import { InternalError, validationErrorFromZod } from "../errors";
import { isStreamArchived } from "../event-store/archive";
import { ArchivedStreamError } from "../event-store/errors";
import { append, getStreamVersion, type StoredEvent } from "../event-store/event-store";
import { runProjectionsForEvent } from "./projections-runner";

// Shared append-pipeline: Schema-validate → archive-guard → stream-version →
// append → inline-projections, plus the stamp-once-only idempotency marker.
// One implementation for both `dispatcher.appendDomainEvent` (write-handler
// `ctx.appendEvent`) and `msp-apply-ctx.appendEvent` (MSP-apply-side). Both
// call-sites differ only in where `userId` comes from (SessionUser vs.
// triggering event metadata) — everything after that is identical.
export type AppendDomainEventCoreDeps = {
  readonly registry: Registry;
  readonly db: DbRunner;
  readonly tenantId: TenantId;
  // stringified user id — executor and dispatcher differ in their SessionUser
  // typing, so we normalise at the boundary.
  readonly userId: string;
  // Label for the "event not registered" error message so the failure points
  // at the caller (e.g. "ctx.appendEvent" vs. "MSP-apply ctx.appendEvent").
  readonly callSiteLabel: string;
};

export async function appendDomainEventCore(
  deps: AppendDomainEventCoreDeps,
  args: AppendEventArgs,
): Promise<StoredEvent> {
  const eventDef = deps.registry.getEvent(args.type);
  if (!eventDef) {
    throw new InternalError({
      message: `${deps.callSiteLabel}("${args.type}") — event not registered. Call r.defineEvent(shortName, schema) in a feature; appendEvent expects the qualified name returned by defineEvent (e.g. "<feature>:event:<short>").`,
    });
  }
  const parsed = eventDef.schema.safeParse(args.payload ?? {});
  if (!parsed.success) throw validationErrorFromZod(parsed.error);
  const validatedPayload = parsed.data as Record<string, unknown>;

  // Archive guard: block writes on archived streams. Without this an append
  // would produce an "invisible" row that loadAggregate filters out by default
  // — silent data loss from the caller's POV.
  if (await isStreamArchived(deps.db, deps.tenantId, args.aggregateId)) {
    throw new ArchivedStreamError(deps.tenantId, args.aggregateId);
  }

  // Stream-version authoritative. See Block 0 / getStreamVersion doc for
  // why row.version isn't sufficient once ctx.appendEvent enters the picture.
  const expectedVersion = await getStreamVersion(deps.db, args.aggregateId, deps.tenantId);

  const reqCtx = requestContext.get();
  // Stamp-once-only idempotency marker: events_idempotency_idx is a partial
  // UNIQUE on (tenantId, metadata->>'requestId'). Only the FIRST event in a
  // request wears the marker; subsequent events in the same tx would
  // collide. See RequestContextData.requestIdUsed docs.
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

  // Inline projections fire in the same tx — a throw rolls everything back
  // together. Same semantics regardless of which call-site triggered the
  // append (write-handler ctx.appendEvent vs. MSP-apply ctx.appendEvent).
  await runProjectionsForEvent(stored, deps.registry, deps.db);

  return stored;
}
