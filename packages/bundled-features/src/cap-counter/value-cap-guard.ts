// Per-tier bounds on a single written number (e.g. a retention period or a page size),
// next to the stock-cap guard, which bounds how many rows may exist.

import type { TenantDb } from "@cosmicdrift/kumiko-framework/db";
import type { WriteHandlerDef } from "@cosmicdrift/kumiko-framework/engine";
import {
  UnprocessableError,
  type WriteFailure,
  writeFailure,
} from "@cosmicdrift/kumiko-framework/errors";
import { readPayloadField } from "./payload-field.js";
import type { CapGuardContext, CapLimitContext } from "./stock-cap-guard.js";

export type ValueCapSpec<TCaps> = {
  readonly field: string;
  /** `undefined` = no lower bound for this tier. */
  readonly min?: (caps: TCaps) => number | undefined;
  /** `undefined` = no upper bound for this tier. */
  readonly max?: (caps: TCaps) => number | undefined;
  readonly code: string;
  readonly i18nKey: string;
};

export type ValueCapGuard<TCaps> = {
  readonly checkValueCap: (
    ctx: CapGuardContext,
    value: unknown,
    spec: ValueCapSpec<TCaps>,
  ) => Promise<WriteFailure | null>;
  readonly withValueCap: (handler: WriteHandlerDef, spec: ValueCapSpec<TCaps>) => WriteHandlerDef;
};

function isOutOfBounds(value: number, min: number | undefined, max: number | undefined): boolean {
  return (min !== undefined && value < min) || (max !== undefined && value > max);
}

export function createValueCapGuard<TCaps>(
  resolveTierCaps: (db: TenantDb, context: CapLimitContext) => Promise<TCaps>,
): ValueCapGuard<TCaps> {
  async function checkValueCap(
    ctx: CapGuardContext,
    value: unknown,
    spec: ValueCapSpec<TCaps>,
  ): Promise<WriteFailure | null> {
    // skip: an absent or non-numeric value is the schema's business, not a cap violation.
    if (typeof value !== "number") return null;
    const caps = await resolveTierCaps(ctx.db, ctx.config ? { config: ctx.config } : {});
    const min = spec.min?.(caps);
    const max = spec.max?.(caps);
    if (!isOutOfBounds(value, min, max)) return null;
    return writeFailure(
      new UnprocessableError(spec.code, {
        i18nKey: spec.i18nKey,
        details: { field: spec.field, value, min, max },
      }),
    );
  }

  function withValueCap(handler: WriteHandlerDef, spec: ValueCapSpec<TCaps>): WriteHandlerDef {
    return {
      ...handler,
      handler: async (event, ctx) => {
        const failure = await checkValueCap(ctx, readPayloadField(event.payload, spec.field), spec);
        return failure ?? handler.handler(event, ctx);
      },
    };
  }

  return { checkValueCap, withValueCap };
}
