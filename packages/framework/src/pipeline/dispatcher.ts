import { hasAccess } from "../engine/access";
import { checkWriteFields, filterReadFields } from "../engine/field-access";
import type {
  PipelineContext,
  PipelineUser,
  Registry,
  SaveContext,
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

export type Dispatcher = {
  write(
    type: string,
    payload: unknown,
    user: PipelineUser,
    requestId?: string,
  ): Promise<WriteResult>;
  query(type: string, payload: unknown, user: PipelineUser): Promise<unknown>;
  command(type: string, payload: unknown, user: PipelineUser): Promise<void>;
  shareEvent(event: BrokerEvent): Promise<void>;
  broadcast(channel: string, event: BrokerEvent): Promise<void>;
};

function extractEntityName(handlerName: string): string | undefined {
  const dotIndex = handlerName.indexOf(".");
  return dotIndex > 0 ? handlerName.slice(0, dotIndex) : undefined;
}

function isSaveContext(data: unknown): data is SaveContext {
  if (!data || typeof data !== "object") return false;
  const obj = data as Record<string, unknown>;
  return "id" in obj && "changes" in obj && "previous" in obj && "isNew" in obj;
}

export function createDispatcher(
  registry: Registry,
  context: PipelineContext,
  options: DispatcherOptions = {},
): Dispatcher {
  const { idempotency, eventLog, lifecycle } = options;

  async function logEvent(type: string, payload: unknown, user: PipelineUser): Promise<void> {
    if (!eventLog) return;
    await eventLog.append({
      type,
      payload: (payload ?? {}) as Record<string, unknown>,
      userId: user.id,
      tenantId: user.tenantId,
    });
  }

  return {
    async write(type, payload, user, requestId?) {
      if (requestId && idempotency) {
        const cached = await idempotency.check(requestId);
        if (cached) return JSON.parse(cached) as WriteResult;
      }

      const handler = registry.getWriteHandler(type);
      if (!handler) return { isSuccess: false, error: `handler_not_found: ${type}` };

      if (handler.access && !hasAccess(user, handler.access)) {
        return { isSuccess: false, error: `access_denied: ${type}` };
      }

      const parsed = handler.schema.safeParse(payload);
      if (!parsed.success) {
        return { isSuccess: false, error: `validation_failed: ${parsed.error.message}` };
      }

      const hookErrors = runValidation(registry, type, parsed.data as Record<string, unknown>);
      if (hookErrors) {
        const messages = hookErrors.map((e) => `${e.field}: ${e.error}`).join(", ");
        return { isSuccess: false, error: `validation_hook: ${messages}` };
      }

      // Field-level write access check
      const entityName = extractEntityName(type);
      if (entityName) {
        const entity = registry.getEntity(entityName);
        if (entity) {
          // Check direct payload fields (create) and changes object (update)
          const fieldsToCheck = (parsed.data as Record<string, unknown>)["changes"] as
            | Record<string, unknown>
            | undefined;
          const writePayload = fieldsToCheck ?? (parsed.data as Record<string, unknown>);
          const deniedField = checkWriteFields(entity, writePayload, user);
          if (deniedField) {
            return { isSuccess: false, error: `field_access_denied: ${deniedField}` };
          }
        }
      }

      // Run handler with lifecycle context
      const handlerContext = { ...context, _entityName: entityName, _userId: user.id };

      const result = await handler.handler({ type, payload: parsed.data, user }, handlerContext);

      // Run postSave lifecycle hooks if result contains SaveContext
      if (result.isSuccess && lifecycle && entityName && isSaveContext(result.data)) {
        await lifecycle.runPostSave(entityName, result.data, handlerContext);
      }

      if (requestId && idempotency) {
        await idempotency.store(requestId, result);
      }

      await logEvent(type, parsed.data, user);

      // Trigger event-based jobs with user context
      if (result.isSuccess && context["jobRunner"]) {
        const jobRunner = context["jobRunner"] as {
          handleEvent: (eventName: string, payload: Record<string, unknown>, user?: PipelineUser) => Promise<void>;
        };
        await jobRunner.handleEvent(type, (parsed.data ?? {}) as Record<string, unknown>, user);
      }

      return result;
    },

    async query(type, payload, user) {
      const handler = registry.getQueryHandler(type);
      if (!handler) throw new Error(`handler_not_found: ${type}`);

      if (handler.access && !hasAccess(user, handler.access)) {
        throw new Error(`access_denied: ${type}`);
      }

      const parsed = handler.schema.safeParse(payload);
      if (!parsed.success) {
        throw new Error(`validation_failed: ${parsed.error.message}`);
      }

      let result = await handler.handler({ type, payload: parsed.data, user }, context);

      // Filter read fields on query results
      const entityName = extractEntityName(type);
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

    async command(type, payload, user) {
      const handler = registry.getWriteHandler(type);
      if (!handler) throw new Error(`handler_not_found: ${type}`);

      if (handler.access && !hasAccess(user, handler.access)) {
        throw new Error(`access_denied: ${type}`);
      }

      const parsed = handler.schema.safeParse(payload);
      if (!parsed.success) {
        throw new Error(`validation_failed: ${parsed.error.message}`);
      }

      const hookErrors = runValidation(registry, type, parsed.data as Record<string, unknown>);
      if (hookErrors) {
        const messages = hookErrors.map((e) => `${e.field}: ${e.error}`).join(", ");
        throw new Error(`validation_hook: ${messages}`);
      }

      const entityName = extractEntityName(type);
      const handlerContext = { ...context, _entityName: entityName, _userId: user.id };

      const result = await handler.handler({ type, payload: parsed.data, user }, handlerContext);

      if (result.isSuccess && lifecycle && entityName && isSaveContext(result.data)) {
        await lifecycle.runPostSave(entityName, result.data, handlerContext);
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
