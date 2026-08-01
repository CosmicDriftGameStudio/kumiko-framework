// Generic stock-cap write-guard factory. Extracted from the near-identical
// cap-guard.ts app copies in show-pony and publicstatus (infra#446) — the
// only per-app variable was the Caps shape and how to resolve it for a
// tenant, so both are now factory parameters.

import { countWhere, type DbRunner, type WhereObject } from "@cosmicdrift/kumiko-framework/db";
import type { TenantId, WriteHandlerDef } from "@cosmicdrift/kumiko-framework/engine";
import {
  UnprocessableError,
  type WriteFailure,
  writeFailure,
} from "@cosmicdrift/kumiko-framework/errors";
import { enforceStockCap } from "./enforce-cap";

export type StockCapSpec<TCaps> = {
  readonly table: Parameters<typeof countWhere>[1];
  readonly limit: (caps: TCaps) => number;
  readonly where?: WhereObject;
  readonly code: string;
  readonly i18nKey: string;
  readonly field: string;
};

export type StockCapGuard<TCaps> = {
  readonly checkStockCap: (
    db: DbRunner,
    tenantId: TenantId,
    spec: StockCapSpec<TCaps>,
  ) => Promise<WriteFailure | null>;
  readonly withStockCap: (handler: WriteHandlerDef, spec: StockCapSpec<TCaps>) => WriteHandlerDef;
};

export function createStockCapGuard<TCaps>(
  resolveTierCaps: (db: DbRunner, tenantId: TenantId) => Promise<TCaps>,
): StockCapGuard<TCaps> {
  async function checkStockCap(
    db: DbRunner,
    tenantId: TenantId,
    spec: StockCapSpec<TCaps>,
  ): Promise<WriteFailure | null> {
    const caps = await resolveTierCaps(db, tenantId);
    const current = await countWhere(db, spec.table, { ...spec.where, tenantId });
    const { state, limit } = enforceStockCap({
      current,
      limit: spec.limit(caps),
      profile: "hardSlot",
    });
    if (state !== "exceeded") return null;
    return writeFailure(
      new UnprocessableError(spec.code, {
        i18nKey: spec.i18nKey,
        details: { field: spec.field, reason: spec.code, current, limit },
      }),
    );
  }

  function withStockCap(handler: WriteHandlerDef, spec: StockCapSpec<TCaps>): WriteHandlerDef {
    return {
      ...handler,
      handler: async (event, ctx) => {
        const failure = await checkStockCap(ctx.db.raw, event.user.tenantId, spec);
        return failure ?? handler.handler(event, ctx);
      },
    };
  }

  return { checkStockCap, withStockCap };
}
