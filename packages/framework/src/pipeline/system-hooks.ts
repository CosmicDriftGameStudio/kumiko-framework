import type { SseBroker } from "../api/sse-broker";
import type { DbRow } from "../db/connection";
import { tenantChannel } from "../engine/constants";
import type { EntityId, Registry } from "../engine/types";
import type { SearchAdapter, SearchDocument } from "../search/types";
import type { EventConsumer } from "./event-dispatcher";
import { PUBSUB_AGGREGATE_TYPE } from "./event-retention";

// --- Search Index Consumer (async, via event-dispatcher) ---
//
// Search-Indexierung läuft seit D.4 als async EventConsumer über den event-
// dispatcher, nicht mehr als synchroner postSave/postDelete-hook. Das
// spiegelt Marten's ISubscription-Pattern: ein einziger async Pfad für alle
// non-inline side-effects.
//
// Event → Search-Op Mapping:
//
//   <entity>.created     → index(tenantId, doc)
//   <entity>.updated     → index(tenantId, doc)   // re-index mit neuem state
//   <entity>.restored    → index(tenantId, doc)   // wiederbeleben
//   <entity>.deleted     → remove(tenantId, type, id)
//
// Der Document-State wird aus dem Event rekonstruiert (kein SaveContext
// mehr available). Regel:
//
//   created:  state = event.payload            // ganze entity ist im payload
//   updated:  state = { ...previous, ...changes }  // rekonstruiert neuen state
//   restored: state = event.payload.previous   // restored field-set
//
// Sensitive fields sind aus dem event log bereits gestrippt (event-store-
// executor.ts), also kriegt der Search-Index sie ebenfalls nicht — das ist
// die gleiche Garantie wie vorher beim postSave-hook.
//
// Batch-Variante gibt's aktuell nicht mehr — jeder Event triggert einen
// eigenen index()-call. Wenn Performance nach Scale-Messung das erfordert,
// kann der event-dispatcher später eine Batch-Handler-Variante bekommen.
export const SEARCH_CONSUMER_NAME = "system:consumer:search";

export function createSearchEventConsumer(
  searchAdapter: SearchAdapter,
  registry: Registry,
): EventConsumer {
  return {
    name: SEARCH_CONSUMER_NAME,
    handler: async (event) => {
      const entityName = event.aggregateType;
      const verb = event.type.split(".").pop();
      const tenantId = event.tenantId;

      // skip: delete takes an early-return after removing the index entry —
      // the "reconstruct state" path below only makes sense for created/
      // updated/restored, which carry field data in the payload.
      if (verb === "deleted") {
        await searchAdapter.remove(tenantId, entityName, event.aggregateId);
        return;
      }

      if (verb !== "created" && verb !== "updated" && verb !== "restored") {
        // skip: other event types (custom domain events, future verbs) don't
        // carry a search-indexable payload shape. If a future feature needs
        // them indexed, it registers its own multiStreamProjection.
        return;
      }

      const state = reconstructStateForSearch(event.payload, verb);
      const doc = buildSearchDocument(entityName, event.aggregateId, state, registry);
      if (!doc) {
        // skip: entity isn't searchable (no searchable fields declared)
        return;
      }
      await searchAdapter.index(tenantId, doc);
    },
  };
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
    const previous = (payload["previous"] as Record<string, unknown> | undefined) ?? {};
    const changes = (payload["changes"] as Record<string, unknown> | undefined) ?? {};
    return { ...previous, ...changes };
  }
  // restored: payload = { previous }. The restored entity is whatever the
  // field-values were at delete time — restore copies them back verbatim.
  return (payload["previous"] as Record<string, unknown> | undefined) ?? {};
}

// Build a SearchDocument from raw field-state. Parallel to the old
// buildSearchDocument that took a SaveContext — same selector logic, just
// a different input shape.
function buildSearchDocument(
  entityName: string,
  entityId: EntityId,
  state: Record<string, unknown>,
  registry: Registry,
): SearchDocument | null {
  const entity = registry.getEntity(entityName);
  if (!entity) return null;

  const searchableFields = registry.getSearchableFields(entityName);
  if (searchableFields.length === 0) return null;

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
        if (parent && typeof parent === "object") {
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

  return {
    entityType: entityName,
    entityId,
    weight: entity.searchWeight ?? 1,
    fields,
  };
}

// --- SSE Broadcast (async, via event-dispatcher) ---
//
// SSE-Broadcast läuft seit D.3 als async EventConsumer über den event-
// dispatcher, nicht mehr als synchroner postSave/postDelete-hook. Das hat
// zwei Konsequenzen:
//
// 1. **Event-native Payload-Shape.** Der SSE-event spiegelt den StoredEvent:
//    `type` ist event.type ("user.created", "unit.updated"), `data` enthält
//    id, aggregateType, version und die event-payload — keine künstliche
//    "system:event:<entity>:<verb>" Hülle mehr. Clients haben direkten
//    Zugriff auf `payload.changes` + `payload.previous` (wie im event-log).
// 2. **Eventual consistency statt Read-after-Write.** Ein SSE-Event kommt
//    ~10–100ms nach dem HTTP-200 (abhängig von pollIntervalMs). UI-Clients
//    die auf optimistic-update setzen merken das nicht; strictly-waiting
//    Clients müssten poll-after-write.
//
// Tests drain deterministisch via `await stack.eventDispatcher.runOnce()`.
export const SSE_BROADCAST_CONSUMER_NAME = "system:consumer:sse-broadcast";

export function createSseBroadcastEventConsumer(sseBroker: SseBroker): EventConsumer {
  return {
    name: SSE_BROADCAST_CONSUMER_NAME,
    handler: async (event) => {
      // skip: pub/sub events (ctx.emit) are feature-internal routing, not
      // intended for automatic SSE fan-out. Features that *do* want a
      // specific pub/sub event broadcast can register their own
      // multiStreamProjection that calls sseBroker directly.
      if (event.aggregateType === PUBSUB_AGGREGATE_TYPE) return;

      sseBroker.pushToChannel(tenantChannel(event.tenantId), {
        type: event.type,
        data: {
          id: event.aggregateId,
          aggregateType: event.aggregateType,
          version: event.version,
          payload: event.payload,
          createdAt: event.createdAt,
        },
      });
    },
  };
}
