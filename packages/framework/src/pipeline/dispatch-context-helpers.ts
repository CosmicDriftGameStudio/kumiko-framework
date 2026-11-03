import type { DbConnection, DbTx } from "../db/connection.ts";
import { buildEntityTable } from "../db/table-builder.ts";
import type { TenantDb } from "../db/tenant-db.ts";
import type { SessionUser } from "../engine/types/index.ts";
import { InternalError } from "../errors/index.ts";
import type { DispatchContext } from "./dispatch-shared.ts";

// Narrowing helper: AppContext.db is DbConnection|TenantDb|undefined. The
// dispatch paths need DbConnection (or DbTx from the caller scope) for
// appendEvent/projection writes; the TenantDb branch is excluded here.
export function resolveDbSource(
  ctx: DispatchContext,
  tx: DbTx | undefined,
): DbConnection | DbTx | undefined {
  return tx ?? resolveAppPoolDb(ctx);
}

export function resolveAppPoolDb(ctx: DispatchContext): DbConnection | undefined {
  return ctx.appContext.db as DbConnection | undefined; // @cast-boundary db-operator
}

// r.systemScope() handlers must go through ctx.systemDb's guarded methods
// (assertTenantMatch / acknowledgeCrossTenant) instead of plain ctx.db —
// "system" mode has no tenant filter at all, so silent ctx.db or
// ctx.db.outsideTransaction use there is a cross-tenant leak. HandlerContext
// has no way to make either field optional per handler (isSystem is a
// runtime-only registry lookup, not a type-level discriminant), so instead
// of omitting the key we hand back a Proxy that throws on first touch,
// naming the handler and pointing at the matching ctx.systemDb escape hatch.
// Only the db guard answers `outsideTransaction` (the inner guard, set by attachOutsideTransaction).
export function createSystemScopedDbGuard(
  handlerType: string,
  fieldName: "db" | "db.outsideTransaction",
  hint: string,
): TenantDb {
  return new Proxy({} as TenantDb, {
    get(target, prop) {
      if (fieldName === "db" && prop === "outsideTransaction") return Reflect.get(target, prop);
      throw new InternalError({
        message:
          `Handler "${handlerType}" is r.systemScope()'d — ctx.${fieldName} is unavailable ` +
          `(it would be unfiltered across every tenant). Use ${hint} ` +
          `instead (attempted to read "${String(prop)}").`,
      });
    },
  });
}

export function isMemberResolutionPrincipal(user: SessionUser): boolean {
  return user.origin === "member-resolution";
}

export function requireDbSource(
  ctx: DispatchContext,
  tx: DbTx | undefined,
  surfaceCall: string,
): DbConnection | DbTx {
  const dbSource = resolveDbSource(ctx, tx);
  if (!dbSource) {
    throw new InternalError({
      message: `${surfaceCall} requires a database connection — none is configured.`,
    });
  }
  return dbSource;
}

export function getTable(
  ctx: DispatchContext,
  entityName: string,
): ReturnType<typeof buildEntityTable> | undefined {
  const { registry, tableCache } = ctx;
  if (tableCache.has(entityName)) return tableCache.get(entityName);
  const entity = registry.getEntity(entityName);
  if (!entity) return undefined;
  const table = buildEntityTable(entityName, entity, {
    relations: registry.getRelations(entityName),
  });
  tableCache.set(entityName, table);
  return table;
}
