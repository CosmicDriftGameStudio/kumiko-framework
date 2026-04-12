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

  return {
    async write(handlerName, payload, user) {
      const handler = registry.getWriteHandler(handlerName);
      if (!handler) throw new Error(`Write handler "${handlerName}" not found in registry`);
      const parsed = handler.schema.parse(payload);
      const handlerCtx = { ...ctx, db: buildDb(handlerName, user) } as HandlerContext;
      return handler.handler({ type: handlerName, payload: parsed, user }, handlerCtx);
    },

    async query(handlerName, payload, user) {
      const handler = registry.getQueryHandler(handlerName);
      if (!handler) throw new Error(`Query handler "${handlerName}" not found in registry`);
      const parsed = handler.schema.parse(payload);
      const handlerCtx = { ...ctx, db: buildDb(handlerName, user) } as HandlerContext;
      return handler.handler({ type: handlerName, payload: parsed, user }, handlerCtx);
    },
  };
}
