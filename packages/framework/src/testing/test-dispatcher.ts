import type { DbConnection } from "../db/connection";
import { createTenantDb } from "../db/tenant-db";
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
  function buildDb(handlerName: string, user: SessionUser) {
    if (!ctx.db) return undefined;
    const isSystem = registry.isHandlerSystemScoped(handlerName);
    return createTenantDb(ctx.db as DbConnection, user.tenantId, isSystem ? "system" : "tenant");
  }

  function buildHandlerCtx(handlerName: string, user: SessionUser): HandlerContext {
    const notify = ctx._notifyFactory
      ? ctx._notifyFactory(user, user.tenantId)
      : undefined;
    return { ...ctx, db: buildDb(handlerName, user), notify } as HandlerContext;
  }

  return {
    async write(handlerName, payload, user) {
      const handler = registry.getWriteHandler(handlerName);
      if (!handler) throw new Error(`Write handler "${handlerName}" not found in registry`);
      const parsed = handler.schema.parse(payload);
      return handler.handler({ type: handlerName, payload: parsed, user }, buildHandlerCtx(handlerName, user));
    },

    async query(handlerName, payload, user) {
      const handler = registry.getQueryHandler(handlerName);
      if (!handler) throw new Error(`Query handler "${handlerName}" not found in registry`);
      const parsed = handler.schema.parse(payload);
      return handler.handler({ type: handlerName, payload: parsed, user }, buildHandlerCtx(handlerName, user));
    },
  };
}
