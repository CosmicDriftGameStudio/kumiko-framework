import type { SseBroker, SseEvent } from "../api/sse-broker";
import { SystemHookNames, SystemHookPriorities, tenantChannel } from "../engine/constants";
import { qn } from "../engine/qualified-name";
import type {
  PostDeleteBatchHookFn,
  PostDeleteHookFn,
  PostSaveBatchHookFn,
  PostSaveHookFn,
  Registry,
  SaveContext,
} from "../engine/types";
import { HookPhases } from "../engine/types";
import type { SearchAdapter, SearchDocument } from "../search/types";
import type { SystemHookDef } from "./lifecycle-pipeline";

// --- Search Index Hook ---

// Per-save variant. Kept for consumers that don't want batch semantics —
// most apps should prefer createSearchIndexBatchHook when the adapter
// supports indexBatch (Meilisearch, Elasticsearch, Typesense).
export function createSearchIndexHook(
  searchAdapter: SearchAdapter,
  registry: Registry,
): SystemHookDef<PostSaveHookFn> {
  return {
    name: SystemHookNames.searchIndex,
    priority: SystemHookPriorities.searchIndex,
    fn: async (result, ctx) => {
      const doc = buildSearchDocument(result, registry, ctx.log);
      // skip: entity not indexable (no searchable fields) — buildSearchDocument returns null
      if (!doc) return;
      const tenantId = result.data["tenantId"] as number;
      await searchAdapter.index(tenantId, doc);
    },
  };
}

// Batch-variant: fire once at the end of a dispatcher batch. Collects every
// successful SaveContext that targets an indexable entity, converts them to
// SearchDocuments, and sends them in a single indexBatch call — one network
// round-trip instead of N sequential index() calls. Groups by tenantId so
// multi-tenant batches still use one call per tenant.
export function createSearchIndexBatchHook(
  searchAdapter: SearchAdapter,
  registry: Registry,
): SystemHookDef<PostSaveBatchHookFn> {
  if (!searchAdapter.indexBatch) {
    throw new Error(
      "createSearchIndexBatchHook: adapter does not implement indexBatch — use createSearchIndexHook (per-save) instead",
    );
  }
  const indexBatch = searchAdapter.indexBatch.bind(searchAdapter);

  return {
    name: SystemHookNames.searchIndex,
    priority: SystemHookPriorities.searchIndex,
    fn: async (results, ctx) => {
      const byTenant = new Map<number, SearchDocument[]>();

      for (const result of results) {
        const doc = buildSearchDocument(result, registry, ctx.log);
        if (!doc) continue;
        const tenantId = result.data["tenantId"] as number;
        const bucket = byTenant.get(tenantId);
        if (bucket) bucket.push(doc);
        else byTenant.set(tenantId, [doc]);
      }

      for (const [tenantId, docs] of byTenant) {
        await indexBatch(tenantId, docs);
      }
    },
  };
}

export function createSearchRemoveBatchHook(
  searchAdapter: SearchAdapter,
): SystemHookDef<PostDeleteBatchHookFn> {
  if (!searchAdapter.removeBatch) {
    throw new Error(
      "createSearchRemoveBatchHook: adapter does not implement removeBatch — use createSearchRemoveHook (per-delete) instead",
    );
  }
  const removeBatch = searchAdapter.removeBatch.bind(searchAdapter);

  return {
    name: SystemHookNames.searchRemove,
    priority: SystemHookPriorities.searchIndex,
    fn: async (payloads) => {
      const byTenant = new Map<number, { entityType: string; entityId: number }[]>();
      for (const p of payloads) {
        if (!p.entityName) continue;
        const tenantId = p.data["tenantId"] as number;
        const entry = { entityType: p.entityName, entityId: p.id };
        const bucket = byTenant.get(tenantId);
        if (bucket) bucket.push(entry);
        else byTenant.set(tenantId, [entry]);
      }
      for (const [tenantId, items] of byTenant) {
        await removeBatch(tenantId, items);
      }
    },
  };
}

// Shared: extract the indexable fields from a SaveContext using the registry's
// searchable-field list. Used by both the per-save and batch hooks so they
// produce byte-identical documents.
function buildSearchDocument(
  result: SaveContext,
  registry: Registry,
  log?: { debug: (msg: string) => void },
): SearchDocument | null {
  const entityName = result.entityName;
  if (!entityName) {
    log?.debug(`searchIndex: skipping — no entityName on result ${result.id}`);
    return null;
  }

  const entity = registry.getEntity(entityName);
  if (!entity) {
    log?.debug(`searchIndex: skipping — entity ${entityName} not registered`);
    return null;
  }

  const searchableFields = registry.getSearchableFields(entityName);
  if (searchableFields.length === 0) {
    log?.debug(`searchIndex: skipping — ${entityName} has no searchable fields`);
    return null;
  }

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
        const parent = result.data[parentKey];
        if (parent && typeof parent === "object") {
          const value = (parent as Record<string, unknown>)[subKey];
          if (value !== undefined) fields[f] = value;
        }
        continue;
      }
    }
    if (result.data[f] !== undefined) {
      fields[f] = result.data[f];
    }
  }

  return {
    entityType: entityName,
    entityId: result.id,
    weight: entity.searchWeight ?? 1,
    fields,
  };
}

// Convenience: returns the system-hooks shape to register for a given
// SearchAdapter. If the adapter supports batch APIs, returns batch hooks
// (one round-trip per dispatcher batch); otherwise falls back to per-save.
// Consumers spread the result directly into their systemHooks config:
//
//   systemHooks: {
//     ...createSearchHooks(adapter, registry),
//     postSave: [createSseBroadcastHook(broker), createAuditTrailHook(log)],
//   }
//
// Framework picks the right hook variant — consumer code stays identical
// regardless of adapter capability. Existing manual registrations keep
// working unchanged.
export function createSearchHooks(
  searchAdapter: SearchAdapter,
  registry: Registry,
): {
  readonly postSave?: readonly SystemHookDef<PostSaveHookFn>[];
  readonly postSaveBatch?: readonly SystemHookDef<PostSaveBatchHookFn>[];
  readonly postDelete?: readonly SystemHookDef<PostDeleteHookFn>[];
  readonly postDeleteBatch?: readonly SystemHookDef<PostDeleteBatchHookFn>[];
} {
  if (searchAdapter.indexBatch && searchAdapter.removeBatch) {
    return {
      postSaveBatch: [createSearchIndexBatchHook(searchAdapter, registry)],
      postDeleteBatch: [createSearchRemoveBatchHook(searchAdapter)],
    };
  }
  return {
    postSave: [createSearchIndexHook(searchAdapter, registry)],
    postDelete: [createSearchRemoveHook(searchAdapter)],
  };
}

export function createSearchRemoveHook(
  searchAdapter: SearchAdapter,
): SystemHookDef<PostDeleteHookFn> {
  return {
    name: SystemHookNames.searchRemove,
    priority: SystemHookPriorities.searchIndex,
    fn: async (payload, ctx) => {
      const entityName = payload.entityName;
      if (!entityName) {
        ctx.log?.debug(`searchRemove: skipping — no entityName on payload ${payload.id}`);
        return;
      }

      const tenantId = payload.data["tenantId"] as number;
      await searchAdapter.remove(tenantId, entityName, payload.id);
    },
  };
}

// --- SSE Broadcast Hook ---

export function createSseBroadcastHook(sseBroker: SseBroker): SystemHookDef<PostSaveHookFn> {
  return {
    name: SystemHookNames.sseBroadcast,
    priority: SystemHookPriorities.sseBroadcast,
    fn: async (result, ctx) => {
      const entityName = result.entityName;
      if (!entityName) {
        ctx.log?.debug(`sseBroadcast: skipping — no entityName on result ${result.id}`);
        return;
      }

      const tenantId = result.data["tenantId"] as number;
      const eventType = result.isNew
        ? qn("system", "event", `${entityName}:created`)
        : qn("system", "event", `${entityName}:updated`);

      const event: SseEvent = {
        type: eventType,
        data: { id: result.id, changes: result.changes },
      };

      sseBroker.pushToChannel(tenantChannel(tenantId), event);
    },
  };
}

export function createSseDeleteBroadcastHook(
  sseBroker: SseBroker,
): SystemHookDef<PostDeleteHookFn> {
  return {
    name: SystemHookNames.sseDeleteBroadcast,
    priority: SystemHookPriorities.sseBroadcast,
    fn: async (payload, ctx) => {
      const entityName = payload.entityName;
      if (!entityName) {
        ctx.log?.debug(`sseDeleteBroadcast: skipping — no entityName on payload ${payload.id}`);
        return;
      }

      const tenantId = payload.data["tenantId"] as number;
      sseBroker.pushToChannel(tenantChannel(tenantId), {
        type: qn("system", "event", `${entityName}:deleted`),
        data: { id: payload.id },
      });
    },
  };
}

// --- Audit Trail Hook ---

export type AuditTrailEntry = {
  timestamp: Date;
  tenantId: number;
  userId: number;
  action: string;
  entityType: string;
  entityId: number;
  changes: Record<string, unknown>;
  previous: Record<string, unknown>;
  isNew: boolean;
};

export type AuditTrailStorage = {
  append(entry: AuditTrailEntry): Promise<void>;
};

export function createAuditTrailHook(storage: AuditTrailStorage): SystemHookDef<PostSaveHookFn> {
  return {
    name: SystemHookNames.auditTrail,
    priority: SystemHookPriorities.auditTrail,
    // Audit rows are DB writes that must be atomic with the entity change:
    // if the write rolls back, the audit entry must roll back too.
    phase: HookPhases.inTransaction,
    fn: async (result, ctx) => {
      const entityName = result.entityName;
      if (!entityName) {
        ctx.log?.debug(`auditTrail: skipping — no entityName on result ${result.id}`);
        return;
      }

      await storage.append({
        timestamp: new Date(),
        tenantId: result.data["tenantId"] as number,
        userId: ctx._userId ?? 0,
        action:
          ctx._handlerType ??
          qn("system", "event", `${entityName}:${result.isNew ? "create" : "update"}`),
        entityType: entityName,
        entityId: result.id,
        changes: result.changes as Record<string, unknown>,
        previous: result.previous as Record<string, unknown>,
        isNew: result.isNew,
      });
    },
  };
}

export function createAuditTrailDeleteHook(
  storage: AuditTrailStorage,
): SystemHookDef<PostDeleteHookFn> {
  return {
    name: SystemHookNames.auditTrailDelete,
    priority: SystemHookPriorities.auditTrail,
    phase: HookPhases.inTransaction,
    fn: async (payload, ctx) => {
      const entityName = payload.entityName;
      if (!entityName) {
        ctx.log?.debug(`auditTrailDelete: skipping — no entityName on payload ${payload.id}`);
        return;
      }

      await storage.append({
        timestamp: new Date(),
        tenantId: payload.data["tenantId"] as number,
        userId: ctx._userId ?? 0,
        action: ctx._handlerType ?? qn("system", "event", `${entityName}:delete`),
        entityType: entityName,
        entityId: payload.id,
        changes: {},
        previous: payload.data as Record<string, unknown>,
        isNew: false,
      });
    },
  };
}
