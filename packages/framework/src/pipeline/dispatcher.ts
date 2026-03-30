import { hasAccess } from "../engine/access";
import type { PipelineContext, PipelineUser, Registry, WriteResult } from "../engine/types";
import { runValidation } from "../engine/validation";

export type Dispatcher = {
  write(type: string, payload: unknown, user: PipelineUser): Promise<WriteResult>;
  query(type: string, payload: unknown, user: PipelineUser): Promise<unknown>;
  command(type: string, payload: unknown, user: PipelineUser): Promise<void>;
};

export function createDispatcher(registry: Registry, context: PipelineContext): Dispatcher {
  return {
    async write(type, payload, user) {
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

      return handler.handler({ type, payload: parsed.data, user }, context);
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

      return handler.handler({ type, payload: parsed.data, user }, context);
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
    },
  };
}
