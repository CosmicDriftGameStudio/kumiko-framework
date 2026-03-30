import { hasAccess } from "../engine/access";
import type { PipelineContext, PipelineUser, Registry, WriteResult } from "../engine/types";
import { runValidation } from "../engine/validation";
import type { BrokerEvent, EventBroker } from "./event-broker";
import type { EventLog } from "./event-log";
import type { IdempotencyGuard } from "./idempotency";

export type DispatcherOptions = {
  idempotency?: IdempotencyGuard;
  eventLog?: EventLog;
  eventBroker?: EventBroker;
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

export function createDispatcher(
  registry: Registry,
  context: PipelineContext,
  options: DispatcherOptions = {},
): Dispatcher {
  const { idempotency, eventLog, eventBroker } = options;

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
      // Idempotency check
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

      const result = await handler.handler({ type, payload: parsed.data, user }, context);

      // Store idempotency
      if (requestId && idempotency) {
        await idempotency.store(requestId, result);
      }

      // Log event
      await logEvent(type, parsed.data, user);

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

      const result = await handler.handler({ type, payload: parsed.data, user }, context);

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

      await handler.handler({ type, payload: parsed.data, user }, context);

      await logEvent(type, parsed.data, user);
    },

    async shareEvent(event) {
      if (!eventBroker) throw new Error("No event broker configured");
      await eventBroker.publish(event);
    },

    async broadcast(channel, event) {
      if (!eventBroker) throw new Error("No event broker configured");
      await eventBroker.publish({ ...event, type: `broadcast:${channel}:${event.type}` });
    },
  };
}
