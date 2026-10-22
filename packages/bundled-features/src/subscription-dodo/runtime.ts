// Call-time key/flag resolution for the subscription-dodo plugin, mirroring
// subscription-stripe/runtime.ts: credentials come from backing:"secrets"
// config keys under SYSTEM_TENANT_ID, so rotation and go-live need no redeploy.
// The factory options survive as env-bridge fallbacks.
//
// Two read paths: post-tenant handlers read the key audited through the
// HandlerContext; the pre-tenant webhook reads the secret un-audited from the
// system SecretsContext the foundation passes in.

import { requireSecretsContext } from "@cosmicdrift/kumiko-bundled-features/secrets";
import {
  type ConfigKeyHandle,
  type HandlerContext,
  SYSTEM_TENANT_ID,
} from "@cosmicdrift/kumiko-framework/engine";
import { FeatureDisabledError, UnconfiguredError } from "@cosmicdrift/kumiko-framework/errors";
import type { SecretsContext } from "@cosmicdrift/kumiko-framework/secrets";
import { parseJsonOrThrow } from "@cosmicdrift/kumiko-framework/utils";
import { createDodoHttp, type DodoRequest, type DodoSend } from "./client.ts";
import { DODO_BASE_URLS, DodoEnvironments, SUBSCRIPTION_DODO_FEATURE } from "./constants.ts";

const API_KEY_HINT =
  "Set the Dodo Payments API key via config:write:set on `subscription-dodo:config:api-key` (or seed it from DODO_PAYMENTS_API_KEY during the env bridge).";

export type DodoRuntimeDeps = {
  readonly apiKeyHandle: ConfigKeyHandle<"text">;
  readonly webhookSecretHandle: ConfigKeyHandle<"text">;
  readonly billingLiveHandle: ConfigKeyHandle<"boolean">;
  readonly environmentHandle: ConfigKeyHandle<"select">;
  readonly send: DodoSend;
  readonly fallback: { readonly apiKey?: string; readonly webhookSecret?: string };
};

// backing:"secrets" values are stored JSON-serialized, so the store read has to
// be parsed back; the env fallback is a plain string and stays raw.
function parseStoredSecret(raw: string | undefined): string | undefined {
  if (raw === undefined || raw.length === 0) return undefined;
  const parsed = parseJsonOrThrow<unknown>(raw, "subscription-dodo credential (backing:secrets)");
  return typeof parsed === "string" && parsed.length > 0 ? parsed : undefined;
}

export type DodoCtxRuntime = {
  readonly call: (ctx: HandlerContext, request: DodoRequest) => Promise<unknown>;
  readonly assertBillingLive: (ctx: HandlerContext, handlerName?: string) => Promise<void>;
  readonly isBillingEnabled: (ctx: HandlerContext) => Promise<boolean>;
};

export type DodoWebhookRuntime = {
  readonly resolveWebhookSecret: (systemSecrets?: SecretsContext) => Promise<string>;
};

export type DodoRuntimes = {
  readonly ctx: DodoCtxRuntime;
  readonly webhook: DodoWebhookRuntime;
};

export function createDodoRuntimes(deps: DodoRuntimeDeps): DodoRuntimes {
  const http = createDodoHttp(deps.send);

  async function ctxApiKey(ctx: HandlerContext): Promise<string> {
    let key: string | undefined;
    if (ctx.secrets) {
      const got = await requireSecretsContext(ctx, SUBSCRIPTION_DODO_FEATURE).get(
        SYSTEM_TENANT_ID,
        deps.apiKeyHandle.name,
      );
      key = parseStoredSecret(got?.reveal());
    }
    if (!key && deps.fallback.apiKey && deps.fallback.apiKey.length > 0) {
      key = deps.fallback.apiKey;
    }
    if (!key) {
      throw new UnconfiguredError({
        feature: SUBSCRIPTION_DODO_FEATURE,
        key: deps.apiKeyHandle.name,
        hint: API_KEY_HINT,
      });
    }
    return key;
  }

  async function baseUrlFor(ctx: HandlerContext): Promise<string> {
    const environment = ctx.config ? await ctx.config(deps.environmentHandle) : undefined;
    return DODO_BASE_URLS[environment === DodoEnvironments.live ? "live" : "test"];
  }

  return {
    ctx: {
      call: async (ctx, request) =>
        http({ baseUrl: await baseUrlFor(ctx), apiKey: await ctxApiKey(ctx) }, request),
      assertBillingLive: async (ctx, handlerName = "create-checkout-session") => {
        const live = ctx.config ? await ctx.config(deps.billingLiveHandle) : undefined;
        if (live !== true) throw new FeatureDisabledError(SUBSCRIPTION_DODO_FEATURE, handlerName);
      },
      isBillingEnabled: async (ctx) => {
        const live = ctx.config ? await ctx.config(deps.billingLiveHandle) : undefined;
        if (live !== true) return false;
        if (deps.fallback.apiKey !== undefined && deps.fallback.apiKey.length > 0) return true;
        // Existence-only probe on every billing-plans render: must stay un-audited.
        return ctx.secrets
          ? await ctx.secrets.has(SYSTEM_TENANT_ID, deps.apiKeyHandle.name)
          : false;
      },
    },
    webhook: {
      resolveWebhookSecret: async (systemSecrets) => {
        if (systemSecrets) {
          // No auditCtx: every webhook would otherwise spam the audit trail.
          const got = await systemSecrets.get(SYSTEM_TENANT_ID, deps.webhookSecretHandle.name);
          const stored = parseStoredSecret(got?.reveal());
          if (stored) return stored;
        }
        const fallback = deps.fallback.webhookSecret;
        if (fallback && fallback.length > 0) return fallback;
        throw new Error(
          `subscription-dodo: '${deps.webhookSecretHandle.name}' unresolved — no system-secret set and no factory fallback. Webhook cannot verify until it is configured.`,
        );
      },
    },
  };
}
