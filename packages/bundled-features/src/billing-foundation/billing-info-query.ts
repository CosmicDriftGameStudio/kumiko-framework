// Generic billing-info query-handler-config factory. Extracted from the
// near-identical billing-info.query.ts app copies in show-pony and
// publicstatus (infra#446) — the only per-app variables were the
// TTier union/resolver, the allowed roles, and how Stripe prices are read
// off the app's extraContext.
//
// Deliberately does NOT call defineQueryHandler itself: apps use different
// wrappers around it (publicstatus's `@app/define`, which adds
// `agent: { expose: false }`; show-pony's plain framework
// `defineQueryHandler`). Calling defineQueryHandler here would bypass
// whatever an app's own wrapper does. Instead this factory returns just the
// handler-config object — name/schema/access/handler — and each app spreads
// it into its own defineQueryHandler call, adding app-specific fields
// (like `agent`) on top.

import type { TenantDb } from "@cosmicdrift/kumiko-framework/db";
import type { HandlerContext, TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { QnTypes, qn, SYSTEM_TENANT_ID, toKebab } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
// kumiko-lint-ignore cross-feature-import SUBSCRIPTION_STRIPE_FEATURE is a plain string const in constants.ts (no imports); the barrel import (../subscription-stripe) would create a module cycle with billing-foundation via feature.ts → verify-webhook.ts, because billing-foundation/index.ts now re-exports billing-info-query.ts.
import { SUBSCRIPTION_STRIPE_FEATURE } from "../subscription-stripe/constants";
import { subscriptionAggregateId } from "./aggregate-id";
import { subscriptionsProjectionTable } from "./projection";

// subscription-stripe addresses its credentials + the live flag as config
// keys (api-key via backing:"secrets" in the secrets store, billingLive
// plain). We only READ them here to surface billing readiness on the
// customer screen — the write-side UI is the feature's auto-derived
// sysadmin settings screen.
const stripeFeature = toKebab(SUBSCRIPTION_STRIPE_FEATURE);
const STRIPE_API_KEY_CONFIG_QN = qn(stripeFeature, QnTypes.config, "api-key");
const STRIPE_BILLING_LIVE_CONFIG_QN = qn(stripeFeature, QnTypes.config, toKebab("billingLive"));

export type BillingInfo<TTier extends string> = {
  readonly enabled: boolean;
  readonly tier: TTier;
  readonly subscription: {
    readonly status: string;
    readonly tier: string;
    readonly providerName: string;
  } | null;
  readonly prices: Readonly<Partial<Record<string, string>>>;
};

export type BillingInfoQueryDeps<TTier extends string> = {
  readonly roles: readonly string[];
  readonly resolveTier: (db: TenantDb, tenantId: TenantId) => Promise<TTier>;
  // ctx is the same HandlerContext the returned handler receives — app
  // implementations read app-specific extraContext fields off it (e.g.
  // publicstatus/show-pony's getBillingPrices(ctx) reads `billingPrices`),
  // so they type their own ctx param as `unknown` and cast internally.
  readonly getBillingPrices: (
    ctx: HandlerContext,
  ) => Readonly<Partial<Record<string, string>>> | null;
};

export function createBillingInfoQueryConfig<TTier extends string>(
  deps: BillingInfoQueryDeps<TTier>,
) {
  return {
    name: "billing-info",
    schema: z.object({}),
    access: { roles: deps.roles },
    async handler(_event: unknown, ctx: HandlerContext): Promise<BillingInfo<TTier>> {
      const tier = await deps.resolveTier(ctx.db, ctx.user.tenantId);
      const prices = deps.getBillingPrices(ctx);
      if (!prices) return { enabled: false, tier, subscription: null, prices: {} };

      const billingLive = ctx.config
        ? (await ctx.config(STRIPE_BILLING_LIVE_CONFIG_QN)) === true
        : false;
      const apiKeySet = ctx.secrets
        ? await ctx.secrets.has(SYSTEM_TENANT_ID, STRIPE_API_KEY_CONFIG_QN)
        : false;

      const sub = await ctx.db.fetchOne<{
        status?: unknown;
        tier?: unknown;
        providerName?: unknown;
      }>(subscriptionsProjectionTable, { id: subscriptionAggregateId(ctx.user.tenantId) });
      return {
        enabled: billingLive && apiKeySet,
        tier,
        subscription:
          sub &&
          typeof sub.status === "string" &&
          typeof sub.tier === "string" &&
          typeof sub.providerName === "string"
            ? { status: sub.status, tier: sub.tier, providerName: sub.providerName }
            : null,
        prices,
      };
    },
  };
}
