import type { SseBroker, SseEvent } from "../api/sse-broker";
import { SystemHookNames, SystemHookPriorities, tenantChannel } from "../engine/constants";
import type { PostDeleteHookFn, PostSaveHookFn, Registry } from "../engine/types";
import type { SearchAdapter } from "../search/types";
import type { SystemHookDef } from "./lifecycle-pipeline";

// --- Search Index Hook ---

export function createSearchIndexHook(
  searchAdapter: SearchAdapter,
  registry: Registry,
): SystemHookDef<PostSaveHookFn> {
  return {
    name: SystemHookNames.searchIndex,
    priority: SystemHookPriorities.searchIndex,
    fn: async (result) => {
      const entityName = result.entityName;
      if (!entityName) return;

      const entity = registry.getEntity(entityName);
      if (!entity) return;

      const searchableFields = registry.getSearchableFields(entityName);
      if (searchableFields.length === 0) return;

      const fields: Record<string, unknown> = {};
      for (const f of searchableFields) {
        if (result.data[f] !== undefined) fields[f] = result.data[f];
      }

      const tenantId = result.data["tenantId"] as number;
      await searchAdapter.index(tenantId, {
        entityType: entityName,
        entityId: result.id,
        weight: entity.searchWeight ?? 1,
        fields,
      });
    },
  };
}

export function createSearchRemoveHook(
  searchAdapter: SearchAdapter,
): SystemHookDef<PostDeleteHookFn> {
  return {
    name: SystemHookNames.searchRemove,
    priority: SystemHookPriorities.searchIndex,
    fn: async (payload) => {
      const entityName = payload.entityName;
      if (!entityName) return;

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
    fn: async (result) => {
      const entityName = result.entityName;
      if (!entityName) return;

      const tenantId = result.data["tenantId"] as number;
      const eventType = result.isNew ? `${entityName}.created` : `${entityName}.updated`;

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
    fn: async (payload) => {
      const entityName = payload.entityName;
      if (!entityName) return;

      const tenantId = payload.data["tenantId"] as number;
      sseBroker.pushToChannel(tenantChannel(tenantId), {
        type: `${entityName}.deleted`,
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
    fn: async (result, ctx) => {
      const entityName = result.entityName;
      if (!entityName) return;

      await storage.append({
        timestamp: new Date(),
        tenantId: result.data["tenantId"] as number,
        userId: ctx._userId ?? 0,
        action: ctx._handlerType ?? `${entityName}.${result.isNew ? "create" : "update"}`,
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
    fn: async (payload, ctx) => {
      const entityName = payload.entityName;
      if (!entityName) return;

      await storage.append({
        timestamp: new Date(),
        tenantId: payload.data["tenantId"] as number,
        userId: ctx._userId ?? 0,
        action: ctx._handlerType ?? `${entityName}.delete`,
        entityType: entityName,
        entityId: payload.id,
        changes: {},
        previous: payload.data as Record<string, unknown>,
        isNew: false,
      });
    },
  };
}
