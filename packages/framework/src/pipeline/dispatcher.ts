import { eq } from "drizzle-orm";
import { buildDrizzleTable } from "../db/table-builder";
import { createTenantDb } from "../db/tenant-db";
import { hasAccess } from "../engine/access";
import { type ErrorCode, ErrorCodes } from "../engine/constants";
import { FrameworkError } from "../engine/errors";
import { checkWriteFields, filterReadFields } from "../engine/field-access";
import { defineTransitions, guardTransition } from "../engine/state-machine";
import type {
  AppContext,
  HandlerContext,
  HandlerRef,
  JobRunnerRef,
  LifecycleResult,
  Registry,
  SessionUser,
  WriteResult,
} from "../engine/types";
import { runValidation } from "../engine/validation";
import type { EventLog } from "./event-log";
import type { IdempotencyGuard } from "./idempotency";
import type { LifecycleHooks } from "./lifecycle-pipeline";

export type DispatcherOptions = {
  idempotency?: IdempotencyGuard;
  eventLog?: EventLog;
  lifecycle?: LifecycleHooks;
  jobRunner?: JobRunnerRef;
};

type HandlerType = string | HandlerRef;

function resolveType(type: HandlerType): string {
  return typeof type === "string" ? type : type.name;
}

export type Dispatcher = {
  write(
    type: HandlerType,
    payload: unknown,
    user: SessionUser,
    requestId?: string,
  ): Promise<WriteResult>;
  query(type: HandlerType, payload: unknown, user: SessionUser): Promise<unknown>;
  command(type: HandlerType, payload: unknown, user: SessionUser): Promise<void>;
};

export function createDispatcher(
  registry: Registry,
  context: AppContext,
  options: DispatcherOptions = {},
): Dispatcher {
  const { idempotency, eventLog, lifecycle, jobRunner } = options;

  // Pre-build tables and transition maps for auto-guard (avoid per-request allocation)
  const tableCache = new Map<string, ReturnType<typeof buildDrizzleTable>>();
  const transitionCache = new Map<string, ReadonlyMap<string, ReadonlySet<string>>>();

  function getTable(entityName: string): ReturnType<typeof buildDrizzleTable> | undefined {
    if (tableCache.has(entityName)) return tableCache.get(entityName);
    const entity = registry.getEntity(entityName);
    if (!entity) return undefined;
    const table = buildDrizzleTable(entityName, entity);
    tableCache.set(entityName, table);
    return table;
  }

  function getTransitions(
    fieldName: string,
    transitionMap: Record<string, readonly string[]>,
  ): ReadonlyMap<string, ReadonlySet<string>> {
    const key = fieldName;
    if (transitionCache.has(key)) return transitionCache.get(key)!;
    const transitions = defineTransitions(transitionMap);
    transitionCache.set(key, transitions);
    return transitions;
  }

  async function logEvent(type: string, payload: unknown, user: SessionUser): Promise<void> {
    if (!eventLog) return;
    await eventLog.append({
      type,
      payload: (payload ?? {}) as Record<string, unknown>,
      userId: user.id,
      tenantId: user.tenantId,
    });
  }

  function buildHandlerContext(type: string, user: SessionUser): HandlerContext {
    const isSystem = registry.isHandlerSystemScoped(type);
    const db = context.db
      ? createTenantDb(
          context.db as import("../db/connection").DbConnection,
          user.tenantId,
          isSystem ? "system" : "tenant",
        )
      : undefined;
    return { ...context, db, _userId: user.id, _handlerType: type } as HandlerContext;
  }

  async function runLifecycle(
    type: string,
    data: unknown,
    handlerContext: HandlerContext,
  ): Promise<void> {
    if (!lifecycle || !data || typeof data !== "object" || !("kind" in data)) return;
    const result = data as LifecycleResult;
    if (result.kind === "save") {
      await lifecycle.runPostSave(type, result, handlerContext);
    } else if (result.kind === "delete") {
      await lifecycle.runPreDelete(type, result, handlerContext);
      await lifecycle.runPostDelete(type, result, handlerContext);
    }
  }

  // Shared write pipeline: validates, executes handler, runs lifecycle + side effects.
  // Used by both write() and command().
  async function executeWrite(
    type: string,
    payload: unknown,
    user: SessionUser,
  ): Promise<WriteResult> {
    const handler = registry.getWriteHandler(type);
    if (!handler) return { isSuccess: false, error: `${ErrorCodes.handlerNotFound}: ${type}` };

    if (handler.access && !hasAccess(user, handler.access)) {
      return { isSuccess: false, error: `${ErrorCodes.accessDenied}: ${type}` };
    }

    const parsed = handler.schema.safeParse(payload);
    if (!parsed.success) {
      return { isSuccess: false, error: `${ErrorCodes.validationFailed}: ${parsed.error.message}` };
    }

    const hookErrors = runValidation(registry, type, parsed.data as Record<string, unknown>);
    if (hookErrors) {
      const messages = hookErrors.map((e) => `${e.field}: ${e.error}`).join(", ");
      return { isSuccess: false, error: `${ErrorCodes.validationHook}: ${messages}` };
    }

    // Field-level write access check
    const entityName = registry.getHandlerEntity(type);
    if (entityName) {
      const entity = registry.getEntity(entityName);
      if (entity) {
        const fieldsToCheck = (parsed.data as Record<string, unknown>)["changes"] as
          | Record<string, unknown>
          | undefined;
        const writePayload = fieldsToCheck ?? (parsed.data as Record<string, unknown>);
        const deniedField = checkWriteFields(entity, writePayload, user);
        if (deniedField) {
          return { isSuccess: false, error: `${ErrorCodes.fieldAccessDenied}: ${deniedField}` };
        }
      }
    }

    const handlerContext = buildHandlerContext(type, user);

    // Auto transition guard: if entity has transitions and handler doesn't skip it
    if (entityName && !handler.skipTransitionGuard) {
      const entity = registry.getEntity(entityName);
      if (entity?.transitions && handlerContext.db) {
        const parsedData = parsed.data as Record<string, unknown>;
        const changes = (parsedData["changes"] as Record<string, unknown>) ?? parsedData;
        const id = (parsedData["id"] as number) ?? undefined;

        for (const [fieldName, transitionMap] of Object.entries(entity.transitions)) {
          const newValue = changes[fieldName] as string | undefined;
          if (!newValue || !id) continue;

          const table = getTable(entityName);
          if (!table) continue;

          const [row] = await handlerContext.db.select().from(table).where(eq(table["id"], id));

          if (!row) continue;
          const currentValue = (row as Record<string, unknown>)[fieldName] as string;
          guardTransition(getTransitions(fieldName, transitionMap), currentValue, newValue);
        }
      }
    }

    const result = await handler.handler({ type, payload: parsed.data, user }, handlerContext);

    if (result.isSuccess) {
      await runLifecycle(type, result.data, handlerContext);

      if (jobRunner) {
        await jobRunner.handleEvent(type, (parsed.data ?? {}) as Record<string, unknown>, user);
      }
    }

    await logEvent(type, parsed.data, user);
    return result;
  }

  return {
    async write(typeOrRef, payload, user, requestId?) {
      const type = resolveType(typeOrRef);

      if (requestId && idempotency) {
        const cached = await idempotency.check(requestId);
        if (cached) return JSON.parse(cached) as WriteResult;
      }

      const result = await executeWrite(type, payload, user);

      if (requestId && idempotency) {
        await idempotency.store(requestId, result);
      }

      return result;
    },

    async query(typeOrRef, payload, user) {
      const type = resolveType(typeOrRef);
      const handler = registry.getQueryHandler(type);
      if (!handler) throw new FrameworkError(ErrorCodes.handlerNotFound, type);

      if (handler.access && !hasAccess(user, handler.access)) {
        throw new FrameworkError(ErrorCodes.accessDenied, type);
      }

      const parsed = handler.schema.safeParse(payload);
      if (!parsed.success) {
        throw new FrameworkError(ErrorCodes.validationFailed, parsed.error.message);
      }

      const handlerContext = buildHandlerContext(type, user);
      let result = await handler.handler({ type, payload: parsed.data, user }, handlerContext);

      // Field-level read filter
      const entityName = registry.getHandlerEntity(type);
      if (entityName) {
        const entity = registry.getEntity(entityName);
        if (entity && result && typeof result === "object") {
          if (Array.isArray(result)) {
            result = result.map((row: Record<string, unknown>) =>
              filterReadFields(entity, row, user),
            );
          } else if ("rows" in (result as Record<string, unknown>)) {
            const r = result as { rows: Record<string, unknown>[]; nextCursor: string | null };
            result = {
              ...r,
              rows: r.rows.map((row) => filterReadFields(entity, row, user)),
            };
          } else {
            result = filterReadFields(entity, result as Record<string, unknown>, user);
          }
        }
      }

      await logEvent(type, parsed.data, user);
      return result;
    },

    async command(typeOrRef, payload, user) {
      const type = resolveType(typeOrRef);
      const result = await executeWrite(type, payload, user);

      if (!result.isSuccess) {
        // Error format: "error_code: detail" — extract code for proper HTTP status
        const colonIdx = result.error.indexOf(": ");
        const code = colonIdx > 0 ? result.error.slice(0, colonIdx) : result.error;
        const detail = colonIdx > 0 ? result.error.slice(colonIdx + 2) : undefined;
        throw new FrameworkError(code as ErrorCode, detail);
      }
    },
  };
}
