import type { PipelineContext, Registry, SessionUser, WriteResult } from "../engine/types";

export type TestDispatcher = {
  write(handlerName: string, payload: Record<string, unknown>, user: SessionUser): Promise<WriteResult>;
  query(handlerName: string, payload: Record<string, unknown>, user: SessionUser): Promise<unknown>;
};

export function createTestDispatcher(registry: Registry, ctx: PipelineContext): TestDispatcher {
  return {
    async write(handlerName, payload, user) {
      const handler = registry.getWriteHandler(handlerName);
      if (!handler) throw new Error(`Write handler "${handlerName}" not found in registry`);
      const parsed = handler.schema.parse(payload);
      return handler.handler({ type: handlerName, payload: parsed, user }, ctx);
    },

    async query(handlerName, payload, user) {
      const handler = registry.getQueryHandler(handlerName);
      if (!handler) throw new Error(`Query handler "${handlerName}" not found in registry`);
      const parsed = handler.schema.parse(payload);
      return handler.handler({ type: handlerName, payload: parsed, user }, ctx);
    },
  };
}
