import type {
  AppContext,
  HandlerContext,
  Registry,
  SessionUser,
  WriteResult,
} from "../engine/types";

export type TestDispatcher = {
  write(
    handlerName: string,
    payload: Record<string, unknown>,
    user: SessionUser,
  ): Promise<WriteResult>;
  query(handlerName: string, payload: Record<string, unknown>, user: SessionUser): Promise<unknown>;
};

export function createTestDispatcher(registry: Registry, ctx: AppContext): TestDispatcher {
  // In tests, db is always present — safe to treat as HandlerContext
  const handlerCtx = ctx as HandlerContext;
  return {
    async write(handlerName, payload, user) {
      const handler = registry.getWriteHandler(handlerName);
      if (!handler) throw new Error(`Write handler "${handlerName}" not found in registry`);
      const parsed = handler.schema.parse(payload);
      return handler.handler({ type: handlerName, payload: parsed, user }, handlerCtx);
    },

    async query(handlerName, payload, user) {
      const handler = registry.getQueryHandler(handlerName);
      if (!handler) throw new Error(`Query handler "${handlerName}" not found in registry`);
      const parsed = handler.schema.parse(payload);
      return handler.handler({ type: handlerName, payload: parsed, user }, handlerCtx);
    },
  };
}
