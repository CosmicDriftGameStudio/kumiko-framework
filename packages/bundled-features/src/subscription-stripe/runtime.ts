// Runtime key/flag-resolution for the subscription-stripe plugin.
//
// **Why this exists (the pivot away from mount-time closures):**
// v1 of this feature baked the Stripe credentials into a closure at
// `createSubscriptionStripeFeature({ apiKey, webhookSecret })`-mount-time.
// Rotating a key or flipping prod live then needed a redeploy. This module
// resolves both at CALL-time instead:
//   - `api-key` + `webhook-secret` from the **secrets** feature, stored
//     under SYSTEM_TENANT_ID (Stripe is app-wide, not per-tenant — secrets
//     v1 only declares `scope:"tenant"`, so app-wide values live under the
//     system tenant, the same convention the config-resolver uses for
//     system-scope rows).
//   - `billing-live` from a **system config** key (default false) — the
//     master switch that gates whether a checkout may create a live session.
//
// The factory-options (`apiKey` / `webhookSecret`) survive as **optional
// fallbacks**: during the env→secrets bridge phase, and in tests that don't
// wire a secrets-context, the closure value is used when no secret is set.
//
// **Two read-paths, by tenant-resolution phase:**
//   - Post-tenant (checkout/portal/cancel): full HandlerContext with a
//     caller identity → audited read via `requireSecretsContext`.
//   - Pre-tenant (webhook sig-verify): no ctx, no caller → raw
//     `SecretsContext.get(SYSTEM_TENANT_ID, handle)` (the sanctioned
//     un-audited framework-internal path). The foundation builds and passes
//     this SecretsContext as the 3rd webhook arg.

import { requireSecretsContext } from "@cosmicdrift/kumiko-bundled-features/secrets";
import {
  type ConfigKeyHandle,
  type HandlerContext,
  type SecretKeyHandle,
  SYSTEM_TENANT_ID,
} from "@cosmicdrift/kumiko-framework/engine";
import { FeatureDisabledError, UnconfiguredError } from "@cosmicdrift/kumiko-framework/errors";
import type { SecretsContext } from "@cosmicdrift/kumiko-framework/secrets";
import Stripe from "stripe";
import { SUBSCRIPTION_STRIPE_FEATURE } from "./constants";

const API_KEY_HINT =
  "Set the system-scoped Stripe API key via secrets:write:set (or seed it from STRIPE_API_KEY during the env bridge).";

/** Memoize Stripe clients by api-key string — a fresh client is built only
 *  when the key actually changes (rotation), so steady-state calls reuse one
 *  connection-pooled instance per key. */
export function createStripeClientCache(): (apiKey: string) => Stripe {
  const cache = new Map<string, Stripe>();
  return (apiKey) => {
    const cached = cache.get(apiKey);
    if (cached) return cached;
    // No apiVersion pin — a string literal breaks consumers' typecheck on newer
    // stripe SDKs (#256); the SDK's own default keeps wire-version and types aligned.
    const client = new Stripe(apiKey);
    cache.set(apiKey, client);
    return client;
  };
}

export type StripeRuntimeDeps = {
  readonly apiKeyHandle: SecretKeyHandle;
  readonly webhookSecretHandle: SecretKeyHandle;
  readonly billingLiveHandle: ConfigKeyHandle<"boolean">;
  readonly fallback: { readonly apiKey?: string; readonly webhookSecret?: string };
};

/** Post-tenant runtime: used by checkout/portal/cancel which carry a full
 *  HandlerContext (audited secret reads, config-gate). */
export type StripeCtxRuntime = {
  readonly clientForCtx: (ctx: HandlerContext) => Promise<Stripe>;
  /** Throws FeatureDisabledError unless `billing-live` config is true. The
   *  #104 invariant: no Stripe session may be created while billing is not
   *  live (sk_test_ keys in prod must not produce a live checkout). */
  readonly assertBillingLive: (ctx: HandlerContext) => Promise<void>;
};

/** Pre-tenant runtime: used by verifyAndParseWebhook (no ctx). Resolves both
 *  keys from the foundation-supplied system SecretsContext, with fallback. */
export type StripeWebhookRuntime = {
  readonly resolve: (
    systemSecrets?: SecretsContext,
  ) => Promise<{ readonly stripe: Stripe; readonly webhookSecret: string }>;
};

export type StripeRuntimes = {
  readonly ctx: StripeCtxRuntime;
  readonly webhook: StripeWebhookRuntime;
};

export function createStripeRuntimes(deps: StripeRuntimeDeps): StripeRuntimes {
  const clientFor = createStripeClientCache();

  async function ctxApiKey(ctx: HandlerContext): Promise<string> {
    let key: string | undefined;
    if (ctx.secrets) {
      const got = await requireSecretsContext(ctx, SUBSCRIPTION_STRIPE_FEATURE).get(
        SYSTEM_TENANT_ID,
        deps.apiKeyHandle,
      );
      key = got?.reveal();
    }
    if (!key && deps.fallback.apiKey && deps.fallback.apiKey.length > 0) {
      key = deps.fallback.apiKey;
    }
    if (!key) {
      throw new UnconfiguredError({
        feature: SUBSCRIPTION_STRIPE_FEATURE,
        key: deps.apiKeyHandle.name,
        hint: API_KEY_HINT,
      });
    }
    return key;
  }

  async function rawRead(
    systemSecrets: SecretsContext | undefined,
    handle: SecretKeyHandle,
    fallback: string | undefined,
  ): Promise<string | undefined> {
    if (systemSecrets) {
      // No auditCtx → un-audited framework-internal read (every webhook would
      // otherwise spam the audit trail). This is the sanctioned no-ctx path.
      const got = await systemSecrets.get(SYSTEM_TENANT_ID, handle);
      const value = got?.reveal();
      if (value && value.length > 0) return value;
    }
    return fallback && fallback.length > 0 ? fallback : undefined;
  }

  return {
    ctx: {
      clientForCtx: async (ctx) => clientFor(await ctxApiKey(ctx)),
      assertBillingLive: async (ctx) => {
        const live = ctx.config ? await ctx.config(deps.billingLiveHandle) : undefined;
        if (live !== true) {
          throw new FeatureDisabledError(SUBSCRIPTION_STRIPE_FEATURE, "create-checkout-session");
        }
      },
    },
    webhook: {
      resolve: async (systemSecrets) => {
        const apiKey = await rawRead(systemSecrets, deps.apiKeyHandle, deps.fallback.apiKey);
        const webhookSecret = await rawRead(
          systemSecrets,
          deps.webhookSecretHandle,
          deps.fallback.webhookSecret,
        );
        if (!apiKey || !webhookSecret) {
          const missing = !apiKey ? deps.apiKeyHandle.name : deps.webhookSecretHandle.name;
          throw new Error(
            `subscription-stripe: '${missing}' unresolved — no system-secret set and no factory fallback. ` +
              "Webhook cannot verify until it is configured.",
          );
        }
        return { stripe: clientFor(apiKey), webhookSecret };
      },
    },
  };
}
