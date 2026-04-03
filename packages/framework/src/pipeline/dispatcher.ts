import { hasAccess } from "../engine/access";
import { ErrorCodes } from "../engine/constants";
import { checkWriteFields, filterReadFields } from "../engine/field-access";
import type {
  DeleteContext,
  HandlerContext,
  HandlerRef,
  PipelineContext,
  Registry,
  SaveContext,
  SessionUser,
  WriteResult,
} from "../engine/types";
import { runValidation } from "../engine/validation";
import type { BrokerEvent } from "./event-broker";
import type { EventLog } from "./event-log";
import type { IdempotencyGuard } from "./idempotency";
import type { LifecyclePipeline } from "./lifecycle-pipeline";

export type DispatcherOptions = {
  idempotency?: IdempotencyGuard;
  eventLog?: EventLog;
  lifecycle?: LifecyclePipeline;
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
  shareEvent(event: BrokerEvent): Promise<void>;
  broadcast(channel: string, event: BrokerEvent): Promise<void>;
};

function isSaveContext(data: unknown): data is SaveContext {
  if (!data || typeof data !== "object") return false;
  const obj = data as Record<string, unknown>;
  return "id" in obj && "changes" in obj && "previous" in obj && "isNew" in obj;
}

function isDeleteContext(data: unknown): data is DeleteContext {
  if (!data || typeof data !== "object") return false;
  const obj = data as Record<string, unknown>;
  // DeleteContext has id + data but NOT changes/previous/isNew
  return "id" in obj && "data" in obj && !("isNew" in obj);
}

export function createDispatcher(
  registry: Registry,
  context: PipelineContext,
  options: DispatcherOptions = {},
): Dispatcher {
  const { idempotency, eventLog, lifecycle } = options;

  async function logEvent(type: string, payload: unknown, user: SessionUser): Promise<void> {
    if (!eventLog) return;
    await eventLog.append({
      type,
      payload: (payload ?? {}) as Record<string, unknown>,
      userId: user.id,
      tenantId: user.tenantId,
    });
  }

  return {
    async write(typeOrRef, payload, user, requestId?) {
      const type = resolveType(typeOrRef);
      if (requestId && idempotency) {
        const cached = await idempotency.check(requestId);
        if (cached) return JSON.parse(cached) as WriteResult;
      }

      const handler = registry.getWriteHandler(type);
      if (!handler) return { isSuccess: false, error: `${ErrorCodes.handlerNotFound}: ${type}` };

      if (handler.access && !hasAccess(user, handler.access)) {
        return { isSuccess: false, error: `${ErrorCodes.accessDenied}: ${type}` };
      }

      const parsed = handler.schema.safeParse(payload);
      if (!parsed.success) {
        return {
          isSuccess: false,
          error: `${ErrorCodes.validationFailed}: ${parsed.error.message}`,
        };
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

      // Run handler with lifecycle context
      const handlerContext = {
        ...context,
        _userId: user.id,
        _handlerType: type,
      } as HandlerContext;

      const result = await handler.handler({ type, payload: parsed.data, user }, handlerContext);

      // Run lifecycle hooks based on result type
      if (result.isSuccess && lifecycle) {
        if (isSaveContext(result.data)) {
          await lifecycle.runPostSave(type, result.data, handlerContext);
        } else if (isDeleteContext(result.data)) {
          await lifecycle.runPreDelete(type, result.data, handlerContext);
          await lifecycle.runPostDelete(type, result.data, handlerContext);
        }
      }

      if (requestId && idempotency) {
        await idempotency.store(requestId, result);
      }

      await logEvent(type, parsed.data, user);

      // Trigger event-based jobs with user context
      if (result.isSuccess && context["jobRunner"]) {
        const jobRunner = context["jobRunner"] as {
          handleEvent: (
            eventName: string,
            payload: Record<string, unknown>,
            user?: SessionUser,
          ) => Promise<void>;
        };
        await jobRunner.handleEvent(type, (parsed.data ?? {}) as Record<string, unknown>, user);
      }

      return result;
    },

    async query(typeOrRef, payload, user) {
      const type = resolveType(typeOrRef);
      const handler = registry.getQueryHandler(type);
      if (!handler) throw new Error(`${ErrorCodes.handlerNotFound}: ${type}`);

      if (handler.access && !hasAccess(user, handler.access)) {
        throw new Error(`${ErrorCodes.accessDenied}: ${type}`);
      }

      const parsed = handler.schema.safeParse(payload);
      if (!parsed.success) {
        throw new Error(`${ErrorCodes.validationFailed}: ${parsed.error.message}`);
      }

      let result = await handler.handler(
        { type, payload: parsed.data, user },
        context as HandlerContext,
      );

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
      const handler = registry.getWriteHandler(type);
      if (!handler) throw new Error(`${ErrorCodes.handlerNotFound}: ${type}`);

      if (handler.access && !hasAccess(user, handler.access)) {
        throw new Error(`${ErrorCodes.accessDenied}: ${type}`);
      }

      const parsed = handler.schema.safeParse(payload);
      if (!parsed.success) {
        throw new Error(`${ErrorCodes.validationFailed}: ${parsed.error.message}`);
      }

      const hookErrors = runValidation(registry, type, parsed.data as Record<string, unknown>);
      if (hookErrors) {
        const messages = hookErrors.map((e) => `${e.field}: ${e.error}`).join(", ");
        throw new Error(`${ErrorCodes.validationHook}: ${messages}`);
      }

      const handlerContext = {
        ...context,
        _userId: user.id,
        _handlerType: type,
      } as HandlerContext;

      const result = await handler.handler({ type, payload: parsed.data, user }, handlerContext);

      if (result.isSuccess && lifecycle) {
        if (isSaveContext(result.data)) {
          await lifecycle.runPostSave(type, result.data, handlerContext);
        } else if (isDeleteContext(result.data)) {
          await lifecycle.runPreDelete(type, result.data, handlerContext);
          await lifecycle.runPostDelete(type, result.data, handlerContext);
        }
      }

      await logEvent(type, parsed.data, user);
    },

    async shareEvent(_event) {
      throw new Error("shareEvent requires eventBroker — not configured");
    },

    async broadcast(_channel, _event) {
      throw new Error("broadcast requires eventBroker — not configured");
    },
  };
}
