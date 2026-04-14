import type { SseBroker, SseEvent } from "../api/sse-broker";
import { SystemHookNames, SystemHookPriorities, tenantChannel } from "../engine/constants";
import { qn } from "../engine/qualified-name";
import type { PostDeleteHookFn, PostSaveHookFn, Registry } from "../engine/types";
import { HookPhases } from "../engine/types";
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
    fn: async (result, ctx) => {
      const entityName = result.entityName;
      if (!entityName) {
        ctx.log?.debug(`searchIndex: skipping — no entityName on result ${result.id}`);
        return;
      }

      const entity = registry.getEntity(entityName);
      if (!entity) {
        ctx.log?.debug(`searchIndex: skipping — entity ${entityName} not registered`);
        return;
      }

      const searchableFields = registry.getSearchableFields(entityName);
      if (searchableFields.length === 0) {
        ctx.log?.debug(`searchIndex: skipping — ${entityName} has no searchable fields`);
        return;
      }

      // Collect embedded field names for sub-field resolution
      const embeddedFields = new Set<string>();
      for (const [fname, fdef] of Object.entries(entity.fields)) {
        if (fdef.type === "embedded") embeddedFields.add(fname);
      }

      const fields: Record<string, unknown> = {};
      for (const f of searchableFields) {
        // Embedded sub-fields: address_street → result.data.address.street
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
