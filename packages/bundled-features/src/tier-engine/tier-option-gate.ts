// Tier-gated options of a select field: one spec drives the availability query the
// renderer shows (disabled option + "from <tier>" hint) and the write-path check that
// actually enforces it, so the two cannot drift apart.

import type { EntityTableMeta, SchemaTable, TenantDb } from "@cosmicdrift/kumiko-framework/db";
import type { WriteHandlerDef } from "@cosmicdrift/kumiko-framework/engine";
import {
  UnprocessableError,
  type WriteFailure,
  writeFailure,
} from "@cosmicdrift/kumiko-framework/errors";
import { isPlainObject } from "@cosmicdrift/kumiko-framework/utils";
import {
  type CapGuardContext,
  type CapLimitContext,
  readPayloadField,
} from "../cap-counter/index.js";

export type TierOptionSpec<TCaps> = {
  readonly field: string;
  readonly options: readonly string[];
  readonly isOptionAllowed: (option: string, caps: TCaps) => boolean;
  readonly code: string;
  readonly i18nKey: string;
  /** Lets an update that resends the unchanged stored value of a no longer allowed
   *  option pass (edit forms submit the whole row). Without it the stored value is not looked up. */
  readonly table?: SchemaTable | EntityTableMeta;
};

export type TierOptionAvailability = {
  readonly value: string;
  readonly disabled: boolean;
  readonly hint?: string;
};

export type TierOptionGateDeps<TTier extends string, TCaps> = {
  /** Ascending: the first tier that allows an option is the one named as required. */
  readonly tierOrder: readonly TTier[];
  readonly capsForTier: (tier: TTier, context: CapLimitContext) => TCaps | Promise<TCaps>;
  readonly resolveTier: (db: TenantDb) => Promise<TTier>;
};

export type TierOptionGate<TTier extends string, TCaps> = {
  readonly optionAvailability: (
    db: TenantDb,
    context: CapLimitContext,
    spec: Pick<TierOptionSpec<TCaps>, "options" | "isOptionAllowed">,
    hintFor: (requiredTier: TTier) => string,
  ) => Promise<readonly TierOptionAvailability[]>;
  /** `recordId` is the id of the edited row; with `spec.table` it enables the unchanged-value pass. */
  readonly checkTierOption: (
    ctx: CapGuardContext,
    value: unknown,
    spec: TierOptionSpec<TCaps>,
    recordId?: string,
  ) => Promise<WriteFailure | null>;
  readonly withTierOptionGate: (
    handler: WriteHandlerDef,
    spec: TierOptionSpec<TCaps>,
  ) => WriteHandlerDef;
};

function limitContextOf(ctx: CapGuardContext): CapLimitContext {
  return ctx.config ? { config: ctx.config } : {};
}

function recordIdOf(payload: unknown): string | undefined {
  return isPlainObject(payload) && typeof payload["id"] === "string" ? payload["id"] : undefined;
}

export function createTierOptionGate<TTier extends string, TCaps>(
  deps: TierOptionGateDeps<TTier, TCaps>,
): TierOptionGate<TTier, TCaps> {
  async function capsPerTier(
    context: CapLimitContext,
  ): Promise<readonly { readonly tier: TTier; readonly caps: TCaps }[]> {
    return Promise.all(
      deps.tierOrder.map(async (tier) => ({ tier, caps: await deps.capsForTier(tier, context) })),
    );
  }

  async function optionAvailability(
    db: TenantDb,
    context: CapLimitContext,
    spec: Pick<TierOptionSpec<TCaps>, "options" | "isOptionAllowed">,
    hintFor: (requiredTier: TTier) => string,
  ): Promise<readonly TierOptionAvailability[]> {
    const currentCaps = await deps.capsForTier(await deps.resolveTier(db), context);
    const tiers = await capsPerTier(context);
    return spec.options.map((value) => {
      if (spec.isOptionAllowed(value, currentCaps)) return { value, disabled: false };
      const required = tiers.find(({ caps }) => spec.isOptionAllowed(value, caps));
      return required === undefined
        ? { value, disabled: true }
        : { value, disabled: true, hint: hintFor(required.tier) };
    });
  }

  async function storedValueMatches(
    ctx: CapGuardContext,
    spec: TierOptionSpec<TCaps>,
    value: string,
    recordId: string | undefined,
  ): Promise<boolean> {
    if (spec.table === undefined || recordId === undefined) return false;
    const stored = await ctx.db.fetchOne<Record<string, unknown>>(spec.table, { id: recordId });
    return stored?.[spec.field] === value;
  }

  async function checkTierOption(
    ctx: CapGuardContext,
    value: unknown,
    spec: TierOptionSpec<TCaps>,
    recordId?: string,
  ): Promise<WriteFailure | null> {
    // skip: an absent or non-string value is the schema's business, not a tier violation.
    if (typeof value !== "string") return null;
    const context = limitContextOf(ctx);
    const currentCaps = await deps.capsForTier(await deps.resolveTier(ctx.db), context);
    if (spec.isOptionAllowed(value, currentCaps)) return null;
    if (await storedValueMatches(ctx, spec, value, recordId)) return null;
    const required = (await capsPerTier(context)).find(({ caps }) =>
      spec.isOptionAllowed(value, caps),
    );
    return writeFailure(
      new UnprocessableError(spec.code, {
        i18nKey: spec.i18nKey,
        details: { field: spec.field, value, requiredTier: required?.tier },
      }),
    );
  }

  function withTierOptionGate(
    handler: WriteHandlerDef,
    spec: TierOptionSpec<TCaps>,
  ): WriteHandlerDef {
    return {
      ...handler,
      handler: async (event, ctx) => {
        const value = readPayloadField(event.payload, spec.field);
        const failure = await checkTierOption(ctx, value, spec, recordIdOf(event.payload));
        return failure ?? handler.handler(event, ctx);
      },
    };
  }

  return { optionAvailability, checkTierOption, withTierOptionGate };
}
