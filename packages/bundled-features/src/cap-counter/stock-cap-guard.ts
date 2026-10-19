// Generic stock-cap write-guard factory. Extracted from the near-identical
// cap-guard.ts app copies in show-pony and publicstatus (infra#446) — the
// only per-app variable was the Caps shape and how to resolve it for a
// tenant, so both are now factory parameters.

import type {
  EntityTableMeta,
  SchemaTable,
  TenantDb,
  WhereObject,
} from "@cosmicdrift/kumiko-framework/db";
import type { ConfigAccessor, WriteHandlerDef } from "@cosmicdrift/kumiko-framework/engine";
import {
  UnprocessableError,
  type WriteFailure,
  writeFailure,
} from "@cosmicdrift/kumiko-framework/errors";
import { enforceStockCap } from "./enforce-cap.ts";

// Runtime inputs a tier's cap limit may depend on, e.g. a SystemAdmin-edited
// budget config key. `config` is the calling handler's accessor, so it is
// bound to the caller's tenant — tier-wide limits belong in system-scoped keys.
export type CapLimitContext = {
  readonly config?: ConfigAccessor;
};

// pg_advisory_xact_lock namespace (int4): 'scap' as ASCII, disjoint from the
// framework's other fixed advisory-lock keys.
const STOCK_CAP_LOCK_NAMESPACE = 0x73636170;

// What the cap guards need from a write handler's ctx.
export type CapGuardContext = CapLimitContext & { readonly db: TenantDb };

export type StockCapSpec<TCaps> = {
  readonly table: SchemaTable | EntityTableMeta;
  readonly limit: (caps: TCaps) => number;
  readonly where?: WhereObject;
  readonly code: string;
  readonly i18nKey: string;
  readonly field: string;
};

export type StockCapGuard<TCaps> = {
  readonly checkStockCap: (
    db: TenantDb,
    spec: StockCapSpec<TCaps>,
    context?: CapLimitContext,
  ) => Promise<WriteFailure | null>;
  readonly withStockCap: (handler: WriteHandlerDef, spec: StockCapSpec<TCaps>) => WriteHandlerDef;
};

export function createStockCapGuard<TCaps>(
  resolveTierCaps: (db: TenantDb, context: CapLimitContext) => Promise<TCaps>,
): StockCapGuard<TCaps> {
  async function checkStockCap(
    db: TenantDb,
    spec: StockCapSpec<TCaps>,
    context: CapLimitContext = {},
  ): Promise<WriteFailure | null> {
    // Lock-free on its own: a direct call outside withStockCap is not atomic.
    const caps = await resolveTierCaps(db, context);
    const current = await db.count(spec.table, { ...spec.where, tenantId: db.tenantId });
    const { state, limit } = enforceStockCap({
      current,
      limit: spec.limit(caps),
      profile: "hardSlot",
    });
    if (state !== "exceeded") return null;
    return writeFailure(
      new UnprocessableError(spec.code, {
        i18nKey: spec.i18nKey,
        details: { field: spec.field, current, limit },
      }),
    );
  }

  function withStockCap(handler: WriteHandlerDef, spec: StockCapSpec<TCaps>): WriteHandlerDef {
    return {
      ...handler,
      handler: async (event, ctx) => {
        // ctx.db is the handler's transaction, so the xact lock releases with its commit or
        // rollback. A handler wrapped in several caps must list them in the same order
        // everywhere; Postgres aborts one side of an inverse order with a deadlock error.
        await ctx.db.advisoryXactLock(STOCK_CAP_LOCK_NAMESPACE, spec.code);
        const failure = await checkStockCap(ctx.db, spec, { config: ctx.config });
        return failure ?? handler.handler(event, ctx);
      },
    };
  }

  return { checkStockCap, withStockCap };
}
