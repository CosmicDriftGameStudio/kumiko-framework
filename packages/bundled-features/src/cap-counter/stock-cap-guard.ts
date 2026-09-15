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
import type { WriteHandlerDef } from "@cosmicdrift/kumiko-framework/engine";
import {
  UnprocessableError,
  type WriteFailure,
  writeFailure,
} from "@cosmicdrift/kumiko-framework/errors";
import { enforceStockCap } from "./enforce-cap";

export type StockCapSpec<TCaps> = {
  readonly table: SchemaTable | EntityTableMeta;
  readonly limit: (caps: TCaps) => number;
  readonly where?: WhereObject;
  readonly code: string;
  readonly i18nKey: string;
  readonly field: string;
};

export type StockCapGuard<TCaps> = {
  readonly checkStockCap: (db: TenantDb, spec: StockCapSpec<TCaps>) => Promise<WriteFailure | null>;
  readonly withStockCap: (handler: WriteHandlerDef, spec: StockCapSpec<TCaps>) => WriteHandlerDef;
};

export function createStockCapGuard<TCaps>(
  resolveTierCaps: (db: TenantDb) => Promise<TCaps>,
): StockCapGuard<TCaps> {
  async function checkStockCap(
    db: TenantDb,
    spec: StockCapSpec<TCaps>,
  ): Promise<WriteFailure | null> {
    const caps = await resolveTierCaps(db);
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
        const failure = await checkStockCap(ctx.db, spec);
        return failure ?? handler.handler(event, ctx);
      },
    };
  }

  return { checkStockCap, withStockCap };
}
