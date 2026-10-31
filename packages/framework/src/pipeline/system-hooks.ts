import type { EntityDefinition } from "@cosmicdrift/kumiko-types/fields";
import type { EntityId } from "@cosmicdrift/kumiko-types/identifiers";
import { isPlainObject } from "@cosmicdrift/kumiko-types/type-guards";
import {
  type AccessInvalidationScope,
  readNonEmptyStringArray,
  type SseBroker,
} from "../api/sse-broker.ts";
import {
  configuredPiiSubjectKms,
  decryptPiiFieldValues,
  isPiiCiphertext,
  PII_ERASED_SENTINEL,
} from "../crypto/index.ts";
import { collectSearchableSubjectFields } from "../crypto/subject-resolver.ts";
import { rehydrateCompoundTypes } from "../db/compound-types.ts";
import type { DbConnection, DbRow } from "../db/connection.ts";
import { createTenantDb, entityTableFromRegistry } from "../db/index.ts";
import { tenantChannel } from "../engine/constants.ts";
import type { AppContext, Registry, TenantId } from "../engine/types/index.ts";

import { InternalError } from "../errors/index.ts";
import type { StoredEvent } from "../event-store/index.ts";
import { createFallbackLogger } from "../logging/utils.ts";
import type { SearchAdapter, SearchDocument } from "../search/types.ts";
import type { EventConsumer } from "./event-dispatcher.ts";

const log = createFallbackLogger("kumiko:search");

// --- Search Index Consumer (async, via event-dispatcher) ---
//
// Search indexing runs as an async EventConsumer through the event dispatcher,
// rather than as a synchronous postSave/postDelete hook. This mirrors Marten's
// ISubscription pattern: one async path for all non-inline side effects.
//
// Event → Search-Op Mapping:
//
//   <entity>.created     → index(tenantId, doc)   // state = event.payload
//   <entity>.updated     → index(tenantId, doc)   // state = { ...previous, ...changes }
//   <entity>.restored    → index(tenantId, doc)   // state = event.payload.previous
//   <entity>.deleted      → remove(tenantId, type, id)
//   <entity>.forgotten    → remove(tenantId, type, id)
//   <entity>.<named>      → index or remove, state read from the live
//                          projection row — a named domain event carries
//                          only a payload slice, not the full entity, so
//                          there's no fixed shape to reconstruct state from
//                          as there is for created/updated/restored.
//                          Only queried when the entity declares searchable
//                          fields/extensions; no row (hard/soft-deleted) →
//                          remove, same as the deleted branch.
//
// Sensitive fields never reach this consumer for created/updated/restored —
// event-store-executor.ts strips them before they land in the event log.
// The projection-row path (named events) reads them from the live table
// instead, so the same sensitive+searchable boot-guard (entity-handler.ts)
// keeps them out there too.
//
// batchHandler collapses a turn's events to one search-op per
// (tenantId, entityType, entityId) and issues one indexBatch/removeBatch
// call per tenant instead of one round-trip per event; handler stays the
// per-event fallback the dispatcher uses when a batch throws.
export const SEARCH_CONSUMER_NAME = "system:consumer:search";

// One resolved search operation for a single event: either the
// document to (re-)index or the entityType/entityId to remove. A
// discriminated union so the batch collapse step (last op per key wins)
// doesn't need to special-case index vs remove.
export type SearchOperation =
  | { readonly kind: "index"; readonly tenantId: TenantId; readonly doc: SearchDocument }
  | {
      readonly kind: "remove";
      readonly tenantId: TenantId;
      readonly entityType: string;
      readonly entityId: EntityId;
    };

// An executor update with includeDeleted leaves the row deleted; indexing it would make it findable again.
function isUpdateOfSoftDeletedRow(event: StoredEvent, verb: string | undefined): boolean {
  return (
    verb === "updated" && reconstructStateForSearch(event.payload, "updated")["isDeleted"] === true
  );
}

// Resolves what one event implies for the search index, without touching
// the adapter — same decision tree the old per-event handler ran inline.
async function resolveSearchOperation(
  event: StoredEvent,
  ctx: AppContext,
  registry: Registry,
): Promise<SearchOperation | undefined> {
  const entityName = event.aggregateType;
  const verb = event.type.split(".").pop();
  const tenantId = event.tenantId;

  // skip: delete/forgotten (and an update on a still soft-deleted row) remove the
  // index entry — reconstruct only makes sense for live created/updated/restored.
  if (verb === "deleted" || verb === "forgotten" || isUpdateOfSoftDeletedRow(event, verb)) {
    return { kind: "remove", tenantId, entityType: entityName, entityId: event.aggregateId };
  }

  let state: Record<string, unknown>;
  if (verb === "created" || verb === "updated" || verb === "restored") {
    state = reconstructStateForSearch(event.payload, verb);
  } else {
    // Named domain event: no fixed payload shape to reconstruct
    // state from. Only worth a projection read when the entity actually
    // declared searchable fields/extensions — same check
    // buildSearchDocument makes below, done here first so a non-
    // searchable entity's named events stay a no-op like before.
    const entity = registry.getEntity(entityName);
    const isSearchable =
      entity !== undefined &&
      (registry.getSearchableFields(entityName).length > 0 ||
        registry.getSearchPayloadExtensions(entityName).length > 0);
    // skip: entity declares no searchable fields/extensions — nothing to
    // index, stays a no-op with no extra query, same as before.
    if (!entity || !isSearchable) return undefined;

    const row = await readProjectionRowForSearch(
      ctx,
      registry,
      entityName,
      entity,
      tenantId,
      event.aggregateId,
    );
    // skip: no live row (hard-deleted stream, or soft-deleted) — same
    // outcome as the deleted/forgotten branch above.
    if (!row) {
      return { kind: "remove", tenantId, entityType: entityName, entityId: event.aggregateId };
    }
    state = row;
  }

  state = await decryptSearchableSubjectFields(entityName, state, registry);
  // skip: erased subject — drop the doc so a rebuild cannot resurrect plaintext.
  if (hasErasedSearchableSubjectField(entityName, state, registry)) {
    return { kind: "remove", tenantId, entityType: entityName, entityId: event.aggregateId };
  }
  const doc = await buildSearchDocument(entityName, event.aggregateId, state, registry);
  // skip: entity isn't searchable (no searchable fields declared)
  if (!doc) return undefined;
  return { kind: "index", tenantId, doc };
}

async function applySearchOperation(
  searchAdapter: SearchAdapter,
  op: SearchOperation,
): Promise<void> {
  if (op.kind === "index") {
    await searchAdapter.index(op.tenantId, op.doc);
  } else {
    await searchAdapter.remove(op.tenantId, op.entityType, op.entityId);
  }
}

// Collapse key for one search op — same (tenant, entity) target as the old
// per-event index()/remove() calls addressed, index and remove share the
// key so a later op in the same turn always overwrites an earlier one
// (update-then-delete ⇒ remove wins, delete-then-restore ⇒ index wins).
function searchOperationKey(op: SearchOperation): string {
  const entityType = op.kind === "index" ? op.doc.entityType : op.entityType;
  const entityId = op.kind === "index" ? op.doc.entityId : op.entityId;
  return `${op.tenantId}\u0000${entityType}\u0000${String(entityId)}`;
}

type SourcedSearchOperation = { readonly op: SearchOperation; readonly sourceEventId: string };

type TenantSearchBucket = {
  toIndex: SearchDocument[];
  toRemove: { entityType: string; entityId: EntityId }[];
  // The collapsed ops in ascending order of the event each one came from.
  sourcedOps: SourcedSearchOperation[];
};

type SearchOperationsByTenant = Map<TenantId, TenantSearchBucket>;

// Resolves every event's op sequentially (the named-event path does DB
// reads, so resolving in parallel would fan out uncapped concurrent
// queries for one turn) and collapses to the last op per
// (tenantId, entityType, entityId) — update-then-delete ⇒ remove wins,
// delete-then-restore ⇒ index wins.
async function resolveSearchOperationsByTenant(
  events: readonly StoredEvent[],
  ctx: AppContext,
  registry: Registry,
): Promise<SearchOperationsByTenant> {
  const byKey = new Map<string, SourcedSearchOperation>();
  for (const event of events) {
    const op = await resolveSearchOperation(event, ctx, registry);
    if (!op) continue;
    const key = searchOperationKey(op);
    // Re-insert so the map order follows the winning event: per-tenant ops stay in event order.
    byKey.delete(key);
    byKey.set(key, { op, sourceEventId: event.id });
  }

  const perTenant: SearchOperationsByTenant = new Map();
  for (const sourced of byKey.values()) {
    const op = sourced.op;
    let bucket = perTenant.get(op.tenantId);
    if (!bucket) {
      bucket = { toIndex: [], toRemove: [], sourcedOps: [] };
      perTenant.set(op.tenantId, bucket);
    }
    bucket.sourcedOps.push(sourced);
    if (op.kind === "index") bucket.toIndex.push(op.doc);
    else bucket.toRemove.push({ entityType: op.entityType, entityId: op.entityId });
  }
  return perTenant;
}

// Flushes one tenant's collapsed ops — indexBatch/removeBatch when the
// adapter implements them, otherwise falls back to looping the single-doc
// methods for that group. Keys were already made disjoint by the collapse
// in resolveSearchOperationsByTenant, so index-vs-remove order here
// doesn't matter.
async function flushSearchOperationsForTenant(
  searchAdapter: SearchAdapter,
  tenantId: TenantId,
  bucket: TenantSearchBucket,
): Promise<void> {
  if (bucket.toIndex.length > 0) {
    if (searchAdapter.indexBatch) {
      await searchAdapter.indexBatch(tenantId, bucket.toIndex);
    } else {
      for (const doc of bucket.toIndex) await searchAdapter.index(tenantId, doc);
    }
  }
  if (bucket.toRemove.length > 0) {
    if (searchAdapter.removeBatch) {
      await searchAdapter.removeBatch(tenantId, bucket.toRemove);
    } else {
      for (const item of bucket.toRemove) {
        await searchAdapter.remove(tenantId, item.entityType, item.entityId);
      }
    }
  }
}

type HeldTenantOperations = { readonly eventIds: readonly string[]; readonly error: unknown };

// A failed tenant batch is replayed op by op. After the collapse every op targets another
// entity, so only the ops that fail are held and the rest land, removes included; the first
// held event is the earliest failing one, which skipPoisonEvent's lastFailedEventId names.
async function flushTenantHoldingFailedOperations(
  searchAdapter: SearchAdapter,
  tenantId: TenantId,
  bucket: TenantSearchBucket,
): Promise<HeldTenantOperations | null> {
  try {
    await flushSearchOperationsForTenant(searchAdapter, tenantId, bucket);
    return null;
  } catch (batchError) {
    // skip: a single op would only repeat the request that just failed.
    if (bucket.sourcedOps.length === 1) {
      return { eventIds: bucket.sourcedOps.map((s) => s.sourceEventId), error: batchError };
    }
  }
  const heldEventIds: string[] = [];
  let firstError: unknown;
  for (const sourced of bucket.sourcedOps) {
    try {
      await applySearchOperation(searchAdapter, sourced.op);
    } catch (error) {
      if (heldEventIds.length === 0) firstError = error;
      heldEventIds.push(sourced.sourceEventId);
    }
  }
  return heldEventIds.length === 0 ? null : { eventIds: heldEventIds, error: firstError };
}

// Spacing for a tenant whose index keeps rejecting writes: its held events come back on every
// dispatcher turn, but Meilisearch is only asked again once the delay has passed.
const TENANT_RETRY_BASE_DELAY_MS = 1_000;
const TENANT_RETRY_MAX_DELAY_MS = 60_000;
// Ten failures span about four minutes of backoff: enough for Meilisearch to restart, short
// enough that a broken index or a poison document reaches ops as an error.
const TENANT_HOLD_ESCALATION_FAILURES = 10;

type TenantRetryState = {
  readonly consecutiveFailures: number;
  readonly retryAtMs: number;
  readonly reason: string;
};

export type SearchEventConsumerOptions = {
  readonly now?: () => number;
};

export function createSearchEventConsumer(
  searchAdapter: SearchAdapter,
  registry: Registry,
  options: SearchEventConsumerOptions = {},
): EventConsumer {
  const now = options.now ?? Date.now;
  // Process memory only: after a restart a held tenant is simply retried at once.
  const tenantRetries = new Map<TenantId, TenantRetryState>();

  function recordTenantFailure(tenantId: TenantId, held: HeldTenantOperations): string {
    const previous = tenantRetries.get(tenantId);
    const consecutiveFailures = (previous?.consecutiveFailures ?? 0) + 1;
    const delayMs = Math.min(
      TENANT_RETRY_BASE_DELAY_MS * 2 ** (consecutiveFailures - 1),
      TENANT_RETRY_MAX_DELAY_MS,
    );
    const message = held.error instanceof Error ? held.error.message : String(held.error);
    const reason =
      consecutiveFailures >= TENANT_HOLD_ESCALATION_FAILURES
        ? `search index of tenant ${tenantId} rejected writes ${consecutiveFailures} times in a row, event ${held.eventIds[0]} stays held until the index is fixed or the event is skipped with skipPoisonEvent: ${message}`
        : `search index of tenant ${tenantId} rejected the write, held for retry: ${message}`;
    tenantRetries.set(tenantId, { consecutiveFailures, retryAtMs: now() + delayMs, reason });
    if (!previous) log.warn(reason);
    if (consecutiveFailures === TENANT_HOLD_ESCALATION_FAILURES) log.error(reason);
    return reason;
  }

  return {
    name: SEARCH_CONSUMER_NAME,
    // ponytail: count-based maxAttempts, not real backoff — retries hammer
    // the search adapter every pollIntervalMs during an outage instead of
    // spacing out. 1200 attempts * 100ms default poll ~= 2min budget for a
    // still-provisioning Meilisearch to come up at boot (was 10 = ~1s,
    // killing the consumer near-instantly). Upgrade path: time-based
    // dead-lettering in event-dispatcher-delivery.ts if 2min isn't enough.
    errorPolicy: { maxAttempts: 1200 },
    handler: async (event, ctx) => {
      const op = await resolveSearchOperation(event, ctx, registry);
      if (op) await applySearchOperation(searchAdapter, op);
    },
    // One tenant's failing index must not stall the others: its failing ops are held for a later
    // turn, and while it backs off all of its ops wait, so per-entity order survives.
    batchHandler: async (events, ctx, turn) => {
      const perTenant = await resolveSearchOperationsByTenant(events, ctx, registry);
      for (const [tenantId, bucket] of perTenant) {
        const retry = tenantRetries.get(tenantId);
        if (retry && retry.retryAtMs > now()) {
          turn.holdForRetry(
            bucket.sourcedOps.map((s) => s.sourceEventId),
            retry.reason,
          );
          continue;
        }
        const held = await flushTenantHoldingFailedOperations(searchAdapter, tenantId, bucket);
        if (held) {
          turn.holdForRetry(held.eventIds, recordTenantFailure(tenantId, held));
          continue;
        }
        if (retry) {
          tenantRetries.delete(tenantId);
          log.info(`search index of tenant ${tenantId} accepts writes again`);
        }
      }
    },
  };
}

// Reads the live projection row for a named domain event, tenant-
// scoped through createTenantDb the same way MultiStreamProjection appliers
// scope their apply()-writes (see api/server.ts), on the table the registry
// actually booted (entityTableFromRegistry) rather than one freshly derived
// from the entity definition alone. undefined means "no live row" — a hard
// delete or a soft-delete — which the caller treats as a remove.
async function readProjectionRowForSearch(
  ctx: AppContext,
  registry: Registry,
  entityName: string,
  entity: EntityDefinition,
  tenantId: TenantId,
  entityId: EntityId,
): Promise<Record<string, unknown> | undefined> {
  // @cast-boundary engine-bridge — consumer ctx.db is always the outer
  // DbConnection: event-dispatcher creation is gated on it being set
  // (api/server.ts), never a HandlerContext's already-tenant-scoped TenantDb.
  const baseDb = ctx.db as DbConnection | undefined;
  // undefined must keep meaning "no live row" (the caller removes the index
  // entry), so a missing db fails the event for retry instead.
  if (!baseDb) {
    throw new InternalError({
      message: `search consumer: no db on the consumer context — cannot read the live row of "${entityName}" ${entityId}`,
    });
  }
  const table = entityTableFromRegistry(registry, entityName, entity);
  const where: Record<string, unknown> = { id: entityId };
  if (entity.softDelete && table["isDeleted"]) {
    where["isDeleted"] = false;
  }
  const row = await createTenantDb({ db: baseDb, tenantId }).fetchOne(table, where);
  if (!row) return undefined;
  const state = rehydrateCompoundTypes(row, entity);
  // The event payload never carries sensitive fields; extensions must not see them via the row either.
  for (const [name, field] of Object.entries(entity.fields)) {
    if ("sensitive" in field && field.sensitive === true) delete state[name];
  }
  return state;
}

// Subject-annotated searchable fields are ciphertext in the event
// payload; decrypt into the derived index only. No KMS → omit ciphertext
// values rather than indexing blobs.
export async function decryptSearchableSubjectFields(
  entityName: string,
  state: Record<string, unknown>,
  registry: Registry,
): Promise<Record<string, unknown>> {
  const entity = registry.getEntity(entityName);
  if (!entity) return state;
  const fields = collectSearchableSubjectFields(entity);
  if (fields.length === 0) return state;
  const kms = configuredPiiSubjectKms();
  if (!kms) {
    const out = { ...state };
    for (const name of fields) {
      if (isPiiCiphertext(out[name])) delete out[name];
    }
    return out;
  }
  try {
    return await decryptPiiFieldValues(state, fields, kms, {
      requestId: "system:consumer:search",
    });
  } catch (err) {
    log.warn(
      `decryptSearchableSubjectFields failed for "${entityName}" — ` +
        `dropping ciphertext fields for this document instead of wedging the consumer.`,
      { err },
    );
    const out = { ...state };
    for (const name of fields) {
      if (isPiiCiphertext(out[name])) delete out[name];
    }
    return out;
  }
}

export function hasErasedSearchableSubjectField(
  entityName: string,
  state: Record<string, unknown>,
  registry: Registry,
): boolean {
  const entity = registry.getEntity(entityName);
  if (!entity) return false;
  return collectSearchableSubjectFields(entity).some((name) => state[name] === PII_ERASED_SENTINEL);
}

// Rebuild the entity-state a search index needs from the event-payload alone.
// Three shapes to handle — see event-store-executor.ts for the emitter side.
function reconstructStateForSearch(
  payload: Record<string, unknown>,
  verb: "created" | "updated" | "restored",
): Record<string, unknown> {
  if (verb === "created") {
    // create: payload IS the entity (minus sensitive fields, already
    // stripped by event-store-executor)
    return payload;
  }
  if (verb === "updated") {
    // update: payload = { changes, previous }. Merge to get the new state
    // the index should reflect. Sensitive fields already filtered out.
    const previous = (payload["previous"] as Record<string, unknown> | undefined) ?? {}; // @cast-boundary engine-payload
    const changes = (payload["changes"] as Record<string, unknown> | undefined) ?? {}; // @cast-boundary engine-payload
    return { ...previous, ...changes };
  }
  // restored: payload = { previous }. The restored entity is whatever the
  // field-values were at delete time — restore copies them back verbatim.
  return (payload["previous"] as Record<string, unknown> | undefined) ?? {}; // @cast-boundary engine-payload
}

// buildSearchDocument runs per save — without dedup a colliding contributor
// key would spam one warn line per write on the hotpath. Scoped per registry
// (not module-global) so each app/test instance dedups independently: a
// process-wide Set would silence the warning for every later registry once any
// registry hit a given collision, and would leak dedup-state across tests.
const warnedKeyCollisionsByRegistry = new WeakMap<Registry, Set<string>>();
function warnOncePerKeyCollision(
  registry: Registry,
  entityName: string,
  key: string,
  isBaseField: boolean,
): void {
  let warned = warnedKeyCollisionsByRegistry.get(registry);
  if (!warned) {
    warned = new Set<string>();
    warnedKeyCollisionsByRegistry.set(registry, warned);
  }
  const dedupKey = `${entityName}:${key}`;
  // skip: already warned for this entity:key collision — dedup the hotpath
  if (warned.has(dedupKey)) return;
  warned.add(dedupKey);
  const collidesWith = isBaseField ? `base field "${key}"` : `earlier contributor key "${key}"`;
  log.warn(
    `searchPayloadExtension on "${entityName}" tried to overwrite ` +
      `${collidesWith} — keeping the first value. Rename the contributor key.`,
  );
}

// Build a SearchDocument from raw field-state. Parallel to the old
// buildSearchDocument that took a SaveContext — same selector logic, just
// a different input shape.
export async function buildSearchDocument(
  entityName: string,
  entityId: EntityId,
  state: Record<string, unknown>,
  registry: Registry,
): Promise<SearchDocument | null> {
  const entity = registry.getEntity(entityName);
  if (!entity) return null;

  const searchableFields = registry.getSearchableFields(entityName);
  const extensions = registry.getSearchPayloadExtensions(entityName);
  // Skip guard: no indexable payload and no extensions means there is no doc.
  // Extensions can populate the index without searchable base fields
  // (for example, customFields-only indexing), so both must be checked.
  if (searchableFields.length === 0 && extensions.length === 0) return null;

  const embeddedFields = new Set<string>();
  for (const [fname, fdef] of Object.entries(entity.fields)) {
    if (fdef.type === "embedded") embeddedFields.add(fname);
  }

  const fields: Record<string, unknown> = {};
  for (const f of searchableFields) {
    const underscoreIdx = f.indexOf("_");
    if (underscoreIdx > 0) {
      const parentKey = f.slice(0, underscoreIdx);
      if (embeddedFields.has(parentKey)) {
        const subKey = f.slice(underscoreIdx + 1);
        const parent = state[parentKey];
        // A list-embedded parent contributes one indexed value per row —
        // Meilisearch indexes a string array as a searchable multi-value.
        if (Array.isArray(parent)) {
          const values = parent
            .filter((row): row is DbRow => Boolean(row) && typeof row === "object")
            .map((row) => row[subKey])
            .filter((value) => value !== undefined);
          if (values.length > 0) fields[f] = values;
        } else if (parent && typeof parent === "object") {
          const value = (parent as DbRow)[subKey];
          if (value !== undefined) fields[f] = value;
        }
        continue;
      }
    }
    if (state[f] !== undefined) {
      fields[f] = state[f];
    }
  }

  // Search-Payload-Extensions: contributors merge flat fields into the
  // search-doc (customFields-bundle / tags / computed-counts / etc.).
  // Sequential await — extensions are expected sync or sub-millisecond async;
  // sequential keeps the path simple and deterministic.
  //
  // Precedence is base-fields-win: a contributor key that collides with a
  // searchable base field is dropped (not silently merged over the real value)
  // and warned. A jsonb custom-field that happens to share a base field name
  // must not shadow the indexed base field.
  const baseFieldKeys = new Set(Object.keys(fields));
  for (const contribute of extensions) {
    const contributed = await contribute({ entityName, entityId, state });
    for (const [key, value] of Object.entries(contributed)) {
      if (Object.hasOwn(fields, key)) {
        warnOncePerKeyCollision(registry, entityName, key, baseFieldKeys.has(key));
        continue;
      }
      fields[key] = value;
    }
  }

  return {
    entityType: entityName,
    entityId,
    weight: entity.searchWeight ?? 1,
    fields,
  };
}

// --- SSE Broadcast (async, via event-dispatcher) ---
//
// The SSE broadcast runs as an async EventConsumer on the event dispatcher,
// not as a synchronous postSave/postDelete hook. Two consequences:
//
// 1. **Signal only.** The frame mirrors the StoredEvent's identity: `type` is
//    event.type ("user.created"), `data` holds id, aggregateType, version and
//    createdAt, never the payload. The tenant channel fans out to every member
//    and to anonymous connections, so field values must not enter the broker
//    or Redis; the client refetches through a query with its own access check.
// 2. **Eventual consistency, not read-after-write.** A frame arrives roughly
//    10 to 100 ms after the HTTP 200 (depends on pollIntervalMs). Clients that
//    must observe their own write poll after writing.
//
// Tests drain deterministically via `await stack.eventDispatcher.runOnce()`,
// or via `drainEventConsumers` for this consumer name specifically.
export const SSE_BROADCAST_CONSUMER_NAME = "system:consumer:sse-broadcast";

export function createSseBroadcastEventConsumer(sseBroker: SseBroker): EventConsumer {
  return {
    name: SSE_BROADCAST_CONSUMER_NAME,
    // Shared delivery: one cursor reads every event exactly once.
    // Fanout to every process's own SSE clients happens below, through
    // sseBroker.pushToChannel — a Redis-backed broker (the default once
    // REDIS_URL is set) republishes across replicas, so every pod's
    // clients still see the event without each pod needing its own cursor.
    delivery: "shared",
    // History is meaningless here — an SSE push for a client that didn't
    // exist yet has no audience to replay it to.
    startFrom: "now",
    handler: async (event) => {
      await sseBroker.pushToChannel(tenantChannel(event.tenantId), {
        type: event.type,
        data: {
          id: event.aggregateId,
          aggregateType: event.aggregateType,
          version: event.version,
          createdAt: event.createdAt,
        },
      });
    },
  };
}

// --- Access-Invalidation Consumer (async, via event-dispatcher) ---
//
// This consumer is the last leg: it watches for the two event types that
// can make an already-issued JWT stale mid-stream and pushes an invalidation
// through sseBroker.publishAccessInvalidation, which
// dispatch-stream.ts's subscribeAccessInvalidation listener turns into an
// AccessDeniedError thrown into the open stream.
//
// Event types are literal strings, not imports — this package (framework)
// cannot depend on bundled-features (sessions, tenant own these events),
// mirrors the es-ops-seed precedent (literal QNs, no subpath import).
//
//   "sessions:event:session-revoked" — payload.userId direct (own aggregate,
//     see bundled-features/sessions/session-revoked-event.ts). Fired for
//     self-service revoke, the privileged cross-tenant revoke-all-for-user
//     (SYSTEM_TENANT_ID-anchored DSGVO Art.18 freeze), and the raw
//     sessionRevoker callback (logout / tenant-switch — the only source
//     that also sets payload.streamScope, see readSessionRevokedScope below).
//     fetchPendingEvents has no tenant predicate, so the SYSTEM_TENANT_ID-
//     anchored event reaches this consumer the same as any other — routing
//     is purely on payload.userId, never on event.tenantId.
//   "personal-access-tokens:event:pat-revoked" — payload.userId direct (own
//     aggregate, see bundled-features/personal-access-tokens/pat-revoked-event.ts).
//     Fired by both the self-service revoke handler and
//     revokeAllPatTokensForUser (password-change / MFA-toggle / DSGVO
//     forget-subject). Always scoped to payload.tokenIds — a PAT revoke
//     never touches another credential's stream.
//   "tenant-membership.updated" / "tenant-membership.deleted" — role change
//     or member removal. userId isn't in payload.changes (update only
//     carries the changed fields, e.g. { roles }) so it's read from
//     payload.previous, the full pre-write entity snapshot written by
//     createEventStoreExecutor. tenantMembershipEntity declares no
//     encrypted/PII fields, so previous.userId is plaintext — no KMS
//     decrypt step; the original handoff assumed encryption that doesn't
//     apply here.
//
// Over-invalidation (e.g. tenant-membership.updated fired by something
// other than a role change) is fail-safe: the stream closes, the client
// reconnects and re-authorizes. No opt-out/allowlist — global-by-default
// specifically so this can't be silently disabled per handler.
//
// Scope note: entityEventName also emits "tenant-membership.forgotten" (DSGVO
// erasure) and ".restored" — .restored re-grants access so ignoring it is
// correct, .forgotten is not currently produced by any user-data-rights
// pipeline for memberships but would be revocation-relevant if it ever is.
// Out of the stated scope (session-revoke + role/membership change), tracked
// rather than handled speculatively here.
export const ACCESS_INVALIDATION_CONSUMER_NAME = "system:consumer:access-invalidation";

const SESSION_REVOKED_EVENT_TYPE = "sessions:event:session-revoked";
const PAT_REVOKED_EVENT_TYPE = "personal-access-tokens:event:pat-revoked";
const TENANT_MEMBERSHIP_UPDATED_EVENT_TYPE = "tenant-membership.updated";
const TENANT_MEMBERSHIP_DELETED_EVENT_TYPE = "tenant-membership.deleted";

function readUserIdFromPreviousSnapshot(payload: Record<string, unknown>): string | undefined {
  const previous = payload["previous"];
  if (!isPlainObject(previous)) return undefined;
  const userId = previous["userId"];
  return typeof userId === "string" && userId.length > 0 ? userId : undefined;
}

// session-revoked's scope resolution, in order:
//   1. streamScope === "revoked-sessions" with a non-empty sessionIds array
//      (only the raw sessionRevoker callback sets this) → narrow "sessions"
//      scope, closes exactly those sids.
//   2. Otherwise, a non-empty keptSessionId ("revoke all others") → spares
//      that one sid, same as before streamScope existed.
//   3. Otherwise → userwide. Events appended before streamScope existed have
//      neither field and fall straight through to this same userwide default
//      they always had — a replay is unaffected.
function readSessionRevokedScope(payload: Record<string, unknown>): AccessInvalidationScope {
  if (payload["streamScope"] === "revoked-sessions") {
    const sessionIds = readNonEmptyStringArray(payload["sessionIds"]);
    if (sessionIds) return { kind: "sessions", sessionIds };
  }
  const keptSessionId = payload["keptSessionId"];
  if (typeof keptSessionId === "string" && keptSessionId.length > 0) {
    return { kind: "all-except-session", keptSessionId };
  }
  return { kind: "user" };
}

// pat-revoked is always narrow — a PAT revoke never has a reason to close
// another credential's stream. Malformed tokenIds fail closed to userwide
// rather than silently dropping the invalidation.
function readPatRevokedScope(payload: Record<string, unknown>): AccessInvalidationScope {
  const tokenIds = readNonEmptyStringArray(payload["tokenIds"]);
  return tokenIds ? { kind: "pat-tokens", tokenIds } : { kind: "user" };
}

const ACCESS_INVALIDATION_BACKOFF_INITIAL_MS = 250;
const ACCESS_INVALIDATION_BACKOFF_MAX_MS = 10_000;

// Only the publish can fail because Redis is unreachable. The consumer must keep retrying those
// until Redis is back (dead-lettering would silently stop every later revocation reaching open
// streams), while any other failure keeps the dispatcher's attempt limit so one poison event
// cannot hold back every later revocation for good.
class AccessInvalidationTransportError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.name = "AccessInvalidationTransportError";
  }
}

function isAccessInvalidationTransportError(
  error: unknown,
): error is AccessInvalidationTransportError {
  return error instanceof AccessInvalidationTransportError;
}

// The gate rethrows without touching Redis until the backoff elapsed.
function withTransportBackoff(
  handle: (event: StoredEvent) => Promise<void>,
  now: () => number,
): (event: StoredEvent) => Promise<void> {
  let delayMs = ACCESS_INVALIDATION_BACKOFF_INITIAL_MS;
  let retryNotBefore = 0;
  let transportError: AccessInvalidationTransportError | null = null;
  return async (event) => {
    if (transportError !== null && now() < retryNotBefore) throw transportError;
    try {
      await handle(event);
      delayMs = ACCESS_INVALIDATION_BACKOFF_INITIAL_MS;
      transportError = null;
    } catch (err) {
      if (isAccessInvalidationTransportError(err)) {
        transportError = err;
        retryNotBefore = now() + delayMs;
        delayMs = Math.min(delayMs * 2, ACCESS_INVALIDATION_BACKOFF_MAX_MS);
      }
      throw err;
    }
  };
}

export function createAccessInvalidationEventConsumer(
  sseBroker: SseBroker,
  opts: { readonly now?: () => number } = {},
): EventConsumer {
  const now = opts.now ?? Date.now;
  const publish = async (userId: string, scope?: AccessInvalidationScope): Promise<void> => {
    try {
      await sseBroker.publishAccessInvalidation(userId, scope);
    } catch (cause) {
      throw new AccessInvalidationTransportError(cause);
    }
  };
  return {
    name: ACCESS_INVALIDATION_CONSUMER_NAME,
    // Count-based dead-lettering would end after a few seconds of Redis downtime.
    errorPolicy: { isTransientError: isAccessInvalidationTransportError },
    // Shared delivery, same reasoning as SSE broadcast: one
    // cursor reads every event once and calls sseBroker.publishAccessInvalidation
    // below, which a Redis-backed broker republishes to every replica's
    // subscribeAccessInvalidation listeners — no per-instance cursor needed
    // to reach every process's open streams for that user.
    delivery: "shared",
    // A revocation for a session/membership from before this instance
    // existed has nothing to invalidate — replaying it would be a no-op at
    // best and a spurious stream-close at worst.
    startFrom: "now",
    handler: withTransportBackoff(async (event) => {
      if (event.type === SESSION_REVOKED_EVENT_TYPE) {
        const userId = event.payload["userId"];
        // skip: malformed session-revoked payload — fail open on this one
        // event rather than dead-lettering the whole consumer (halt-on-
        // poison would otherwise permanently stop access-invalidation for
        // every user behind one bad row).
        if (typeof userId !== "string" || userId.length === 0) return;
        await publish(userId, readSessionRevokedScope(event.payload));
      }

      if (event.type === PAT_REVOKED_EVENT_TYPE) {
        const userId = event.payload["userId"];
        // skip: malformed pat-revoked payload — same fail-open reasoning as
        // session-revoked above.
        if (typeof userId !== "string" || userId.length === 0) return;
        await publish(userId, readPatRevokedScope(event.payload));
      }

      if (
        event.type === TENANT_MEMBERSHIP_UPDATED_EVENT_TYPE ||
        event.type === TENANT_MEMBERSHIP_DELETED_EVENT_TYPE
      ) {
        const userId = readUserIdFromPreviousSnapshot(event.payload);
        // skip: previous snapshot missing/malformed userId — same fail-open
        // reasoning as above.
        if (userId === undefined) return;
        await publish(userId);
      }
    }, now),
  };
}
