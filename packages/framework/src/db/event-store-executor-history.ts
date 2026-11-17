// The history verbs (history/listAsOf) of the event-store-executor. They read the event
// stream instead of the projected table, so past values come back upcast, decrypted and
// filtered by the caller's field rights.

import type {
  EntityHistoryEntry,
  EventStoreExecutor,
} from "@cosmicdrift/kumiko-types/event-store-executor-types";
import type { EntityDefinition } from "@cosmicdrift/kumiko-types/fields";
import type { TenantDb } from "@cosmicdrift/kumiko-types/tenant-db-types";
import { isPlainObject } from "@cosmicdrift/kumiko-types/type-guards";
import { maskWriteOnlyFields } from "../engine/field-access.ts";
import { normalizeAccessEntry } from "../engine/ownership.ts";
import type { SessionUser, TenantId } from "../engine/types/index.ts";
import { AccessDeniedError, InternalError } from "../errors/index.ts";
import { loadAggregate, loadAggregateTypeAsOf } from "../event-store/event-store.ts";
import type { StoredEvent } from "../event-store/index.ts";
import { makeUpcastCtx, upcastStoredEvents } from "../event-store/upcaster.ts";
import { type AutoVerb, parseAutoVerb } from "./apply-entity-event.ts";
import { rehydrateCompoundTypes } from "./compound-types.ts";
import type { DbRunner } from "./connection.ts";
import type { ExecutorContext } from "./event-store-executor-context.ts";
import { isFrameworkSystemUser } from "./lock-guard.ts";
import { projectionRegistryOf } from "./projection-registry-binding.ts";
import { resolveReadOwnership } from "./read-ownership.ts";
import { schemaTableName } from "./table-introspection.ts";
import { tenantDbRunnerForTable } from "./tenant-db-runner.ts";

function eventValues(event: StoredEvent, verb: AutoVerb): Record<string, unknown> {
  if (verb === "created") return event.payload;
  if (verb !== "updated") return {};
  const changes = event.payload["changes"];
  return isPlainObject(changes) ? changes : {};
}

// Mirrors applyEntityEvent.
function foldRowsAsOf(
  events: readonly StoredEvent[],
  entity: EntityDefinition,
): Map<string, Record<string, unknown>> {
  const rows = new Map<string, Record<string, unknown>>();
  for (const event of events) {
    const id = event.aggregateId;
    const row = rows.get(id);
    const verb = parseAutoVerb(event, entity);
    if (verb === null) {
      // Domain events move row.version too (decisions.md 2026-11-17).
      if (row !== undefined) rows.set(id, { ...row, version: event.version });
      continue;
    }
    switch (verb) {
      case "created":
        rows.set(id, {
          ...event.payload,
          id,
          version: event.version,
          isDeleted: false,
        });
        break;
      case "updated":
        if (row !== undefined) {
          rows.set(id, { ...row, ...eventValues(event, "updated"), version: event.version });
        }
        break;
      case "deleted":
        if (entity.softDelete === true) {
          if (row !== undefined) rows.set(id, { ...row, isDeleted: true, version: event.version });
        } else {
          rows.delete(id);
        }
        break;
      case "restored":
        if (row !== undefined) rows.set(id, { ...row, isDeleted: false, version: event.version });
        break;
      case "forgotten":
        rows.delete(id);
        break;
    }
  }
  return rows;
}

export function createHistoryVerbs(
  ctx: ExecutorContext,
): Pick<EventStoreExecutor, "history" | "listAsOf"> {
  const { entity, entityName, table } = ctx;

  async function upcastEntityEvents(
    events: readonly StoredEvent[],
    db: TenantDb,
    runner: DbRunner,
    tenantId: TenantId,
  ): Promise<readonly StoredEvent[]> {
    const registry = projectionRegistryOf(db);
    if (registry === undefined) {
      if ((entity.eventVersion ?? 1) > 1) {
        throw new InternalError({
          message: `history/listAsOf of "${entityName}" needs a TenantDb bound to the app registry to upcast eventVersion ${entity.eventVersion} events`,
        });
      }
      return events;
    }
    return upcastStoredEvents(
      events,
      registry.getEventUpcasters(),
      makeUpcastCtx(runner, tenantId),
    );
  }

  // Ownership rules (from/where) cannot be checked against a past event, so a field behind one counts as restricted (audit rule 2026-11-17).
  function mayReadPastField(fieldName: string, user: SessionUser): boolean {
    if (isFrameworkSystemUser(user)) return true;
    const field = entity.fields[fieldName];
    if (field === undefined) return true;
    if (
      field.type === "embedded" &&
      Object.values(field.schema).some((sub) => {
        const subMap = normalizeAccessEntry(sub.access?.read);
        return subMap !== undefined && !user.roles.some((role) => subMap[role] === "all");
      })
    ) {
      return false;
    }
    const accessMap = normalizeAccessEntry(field.access?.read);
    return accessMap === undefined || user.roles.some((role) => accessMap[role] === "all");
  }

  // The fold reads a whole tenant's streams, so another tenant needs the same db binding writes require.
  function assertStreamTenantBinding(
    db: TenantDb,
    requested: TenantId | undefined,
    verbName: string,
  ): void {
    if (requested !== undefined && db.mode !== "system" && db.tenantId !== requested) {
      throw new AccessDeniedError({
        message: `${verbName} of "${entityName}": streamTenantId requires a system-mode db or a db bound to that tenant`,
      });
    }
  }

  async function readableValues(
    values: Record<string, unknown>,
    user: SessionUser,
  ): Promise<Record<string, unknown>> {
    const decrypted = await ctx.decryptForRead(rehydrateCompoundTypes(values, entity), {
      degradeUndecryptable: () => {},
    });
    const kept = Object.fromEntries(
      Object.entries(ctx.stripSensitive(decrypted)).filter(([key]) => mayReadPastField(key, user)),
    );
    return maskWriteOnlyFields(entity, kept);
  }

  return {
    async history(payload, user, db, options) {
      assertStreamTenantBinding(db, options?.streamTenantId, "history");
      if (!(await ctx.isRowReadable(payload.id, user, db, options?.parentVisibility))) return null;
      const streamTenant = ctx.streamTenantFor(user, options?.streamTenantId);
      const runner = tenantDbRunnerForTable(db, table);
      const events = await upcastEntityEvents(
        await loadAggregate(runner, String(payload.id), streamTenant, {
          aggregateType: entityName,
        }),
        db,
        runner,
        streamTenant,
      );
      const entries: EntityHistoryEntry[] = [];
      for (const event of events) {
        const verb = parseAutoVerb(event, entity);
        // Domain events do not belong in the entity history.
        if (verb === null) continue;
        entries.push({
          version: event.version,
          at: event.createdAt,
          by: event.createdBy,
          verb: event.type.slice(entityName.length + 1),
          changes: await readableValues(eventValues(event, verb), user),
        });
      }
      return entries;
    },

    async listAsOf(payload, user, db, options) {
      if (entity.parentRef !== undefined || entity.readGate !== undefined) {
        throw new AccessDeniedError({
          message: `listAsOf of "${entityName}": rows behind parentRef or readGate cannot be checked as of a past instant`,
        });
      }
      // A past row cannot be checked against SQL ownership, so any ownership clause refuses.
      const ownership = resolveReadOwnership(
        ctx,
        String(schemaTableName(table)),
        user,
        db,
        undefined,
        { includeDeleted: false, narrowTypes: undefined },
      );
      if (ownership.kind !== "pass") {
        throw new AccessDeniedError({
          message: `listAsOf of "${entityName}": rows behind a row read ownership cannot be checked as of a past instant`,
        });
      }
      const requestedStreamTenant = options?.streamTenantId;
      assertStreamTenantBinding(db, requestedStreamTenant, "listAsOf");
      const streamTenant = ctx.streamTenantFor(user, requestedStreamTenant);
      const runner = tenantDbRunnerForTable(db, table);
      const events = await upcastEntityEvents(
        await loadAggregateTypeAsOf(runner, entityName, streamTenant, payload.asOf),
        db,
        runner,
        streamTenant,
      );
      const rows: Record<string, unknown>[] = [];
      for (const row of foldRowsAsOf(events, entity).values()) {
        if (row["isDeleted"] === true) continue;
        const { isDeleted: _isDeleted, ...visible } = row;
        rows.push(await readableValues(visible, user));
      }
      return rows;
    },
  };
}
