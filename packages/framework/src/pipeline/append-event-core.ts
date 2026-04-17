import { requestContext } from "../api/request-context";
import type { DbRunner } from "../db/connection";
import { toKebab } from "../engine/qualified-name";
import type { AppendEventArgs, Registry, TenantId } from "../engine/types";
import { InternalError, validationErrorFromZod } from "../errors";
import { isStreamArchived } from "../event-store/archive";
import { ArchivedStreamError } from "../event-store/errors";
import { append, getStreamVersion, type StoredEvent } from "../event-store/event-store";
import { runProjectionsForEvent } from "./projections-runner";

// Shared append-pipeline: Schema-validate → archive-guard → stream-version →
// append → inline-projections. One implementation for both
// `dispatcher.appendDomainEvent` (write-handler `ctx.appendEvent`) and
// `multi-stream-apply-context.appendEvent` (MSP-apply-side). Both call-sites
// differ only in where `userId` comes from (SessionUser vs. triggering event
// metadata) — everything after that is identical.
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
  // Feature that issued the append — used to enforce cross-feature ownership:
  // events are owned by the feature that r.defineEvent'd them. When provided,
  // appendDomainEventCore rejects any args.type whose feature-prefix does not
  // match this caller. Omit for internal framework calls that legitimately
  // cross features.
  readonly callerFeature?: string;
};

// Extract the owning feature from a qualified event name. Events are
// registered as "<feature>:event:<short>" (see registry.ts qualify()) so the
// prefix before the first ":" is the owner. Falls back to undefined if the
// name isn't qualified — callers then skip the cross-feature check.
function eventOwnerFeature(qualifiedName: string): string | undefined {
  const idx = qualifiedName.indexOf(":");
  return idx > 0 ? qualifiedName.slice(0, idx) : undefined;
}

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
  // Cross-feature ownership: features don't get to emit each other's events.
  // Silent cross-feature writes would make event-store semantics fragile —
  // a rename or schema-evolution in feature A could break an unrelated
  // handler in feature B. The contract is: if you want feature A's state to
  // react to feature B, wire an r.multiStreamProjection in A against B's
  // events and let A emit its OWN follow-up on A's stream.
  //
  // Feature names are registered case-preserving (pubsubOrders) but qualified
  // into kebab-case for the event/handler names (pubsub-orders:event:…) — so
  // we compare the kebab form on both sides.
  if (deps.callerFeature) {
    const owner = eventOwnerFeature(args.type);
    const callerKebab = toKebab(deps.callerFeature);
    if (owner && owner !== callerKebab) {
      throw new InternalError({
        message: `${deps.callSiteLabel}("${args.type}") — event belongs to feature "${owner}" but the caller runs in feature "${callerKebab}". Events are owned by the feature that defines them. Either move r.defineEvent into "${callerKebab}", or react via r.multiStreamProjection and emit a follow-up event you own.`,
      });
    }
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
  // metadata.requestId is a plain trace marker — no uniqueness constraint,
  // every event of the request carries it. HTTP-level idempotency runs in
  // pipeline/idempotency.ts (Redis-backed cached-response replay) BEFORE
  // the command executes, so retries never reach this code path twice for
  // the same request.
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
      ...(reqCtx?.requestId ? { requestId: reqCtx.requestId } : {}),
      ...(reqCtx?.correlationId ? { correlationId: reqCtx.correlationId } : {}),
      ...(reqCtx?.causationId ? { causationId: reqCtx.causationId } : {}),
    },
  });

  // Inline projections fire in the same tx — a throw rolls everything back
  // together. Same semantics regardless of which call-site triggered the
  // append (write-handler ctx.appendEvent vs. MSP-apply ctx.appendEvent).
  await runProjectionsForEvent(stored, deps.registry, deps.db);

  return stored;
}
