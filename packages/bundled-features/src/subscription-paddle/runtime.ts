// Call-time key/flag resolution for the subscription-paddle plugin, mirroring
// subscription-stripe/runtime.ts: credentials come from backing:"secrets" config
// keys under SYSTEM_TENANT_ID, so rotation and go-live need no redeploy.
// The factory options survive as env-bridge fallbacks.
//
// Two read paths: post-tenant handlers read the key audited through the
// HandlerContext; the pre-tenant webhook reads secrets un-audited from the
// system SecretsContext the foundation passes in.

import type { SubscriptionProviderPlugin } from "@cosmicdrift/kumiko-bundled-features/billing-foundation";
import { requireSecretsContext } from "@cosmicdrift/kumiko-bundled-features/secrets";
import {
  type ConfigKeyHandle,
  type HandlerContext,
  SYSTEM_TENANT_ID,
} from "@cosmicdrift/kumiko-framework/engine";
import { FeatureDisabledError, UnconfiguredError } from "@cosmicdrift/kumiko-framework/errors";
import type { SecretsContext } from "@cosmicdrift/kumiko-framework/secrets";
import { parseJsonSafe } from "@cosmicdrift/kumiko-framework/utils";
import { createPaddleHttp, type PaddleRequest, type PaddleSend } from "./client.ts";
import {
  PADDLE_BASE_URLS,
  type PaddleEnvironment,
  PaddleEnvironments,
  SUBSCRIPTION_PADDLE_FEATURE,
} from "./constants.ts";

export type PaddlePluginMethod<TName extends keyof SubscriptionProviderPlugin> = NonNullable<
  SubscriptionProviderPlugin[TName]
>;

export type PaddleFallbacks = {
  readonly apiKey?: string;
  readonly webhookSecret?: string;
  readonly tenantBindingKey?: string;
  readonly clientToken?: string;
};

export type PaddleRuntimeDeps = {
  readonly apiKeyHandle: ConfigKeyHandle<"text">;
  readonly webhookSecretHandle: ConfigKeyHandle<"text">;
  readonly tenantBindingKeyHandle: ConfigKeyHandle<"text">;
  readonly clientTokenHandle: ConfigKeyHandle<"text">;
  readonly billingLiveHandle: ConfigKeyHandle<"boolean">;
  readonly environmentHandle: ConfigKeyHandle<"select">;
  readonly send: PaddleSend;
  readonly fallback: PaddleFallbacks;
};

// backing:"secrets" values are stored JSON-serialized, so the store read has to
// be parsed back; the env fallback is a plain string and stays raw. The error
// must not carry the input: the JSON parser's own message would repeat the
// credential into logs and, for webhooks, into the 401 body.
function parseStoredSecret(raw: string | undefined): string | undefined {
  if (raw === undefined || raw.length === 0) return undefined;
  const parsed = parseJsonSafe<unknown>(raw, undefined);
  if (parsed === undefined) {
    throw new Error("subscription-paddle credential (backing:secrets) is not valid JSON");
  }
  return typeof parsed === "string" && parsed.length > 0 ? parsed : undefined;
}

function hintFor(shortName: string): string {
  return `Set it via config:write:set on \`${SUBSCRIPTION_PADDLE_FEATURE}:config:${shortName}\` (or seed it from the matching PADDLE_* variable during the env bridge).`;
}

export type PaddleCtxRuntime = {
  readonly call: (ctx: HandlerContext, request: PaddleRequest) => Promise<unknown>;
  readonly assertBillingLive: (ctx: HandlerContext, handlerName?: string) => Promise<void>;
  readonly isBillingEnabled: (ctx: HandlerContext) => Promise<boolean>;
  readonly tenantBindingKey: (ctx: HandlerContext) => Promise<string>;
};

export type PaddleWebhookRuntime = {
  readonly resolveWebhookSecret: (systemSecrets?: SecretsContext) => Promise<string>;
  readonly resolveTenantBindingKey: (systemSecrets?: SecretsContext) => Promise<string>;
};

export type PaddleCheckoutConfig = {
  readonly clientToken: string | null;
  readonly environment: PaddleEnvironment;
};

export type PaddleRuntimes = {
  readonly ctx: PaddleCtxRuntime;
  readonly webhook: PaddleWebhookRuntime;
  readonly readCheckoutConfig: (
    ctx: Pick<HandlerContext, "config">,
  ) => Promise<PaddleCheckoutConfig>;
};

function environmentOf(value: string | undefined): PaddleEnvironment {
  return value === PaddleEnvironments.live ? PaddleEnvironments.live : PaddleEnvironments.sandbox;
}

export function createPaddleRuntimes(deps: PaddleRuntimeDeps): PaddleRuntimes {
  const http = createPaddleHttp(deps.send);

  async function ctxSecret(
    ctx: HandlerContext,
    handle: ConfigKeyHandle<"text">,
    fallback: string | undefined,
    shortName: string,
  ): Promise<string> {
    let value: string | undefined;
    if (ctx.services.secrets) {
      const got = await requireSecretsContext(
        { secrets: ctx.services.secrets, user: ctx.user },
        SUBSCRIPTION_PADDLE_FEATURE,
      ).get(SYSTEM_TENANT_ID, handle.name);
      value = parseStoredSecret(got?.reveal());
    }
    if (!value && fallback && fallback.length > 0) value = fallback;
    if (!value) {
      throw new UnconfiguredError({
        feature: SUBSCRIPTION_PADDLE_FEATURE,
        key: handle.name,
        hint: hintFor(shortName),
      });
    }
    return value;
  }

  async function webhookSecret(
    systemSecrets: SecretsContext | undefined,
    handle: ConfigKeyHandle<"text">,
    fallback: string | undefined,
  ): Promise<string> {
    if (systemSecrets) {
      // No auditCtx: every webhook would otherwise spam the audit trail.
      const got = await systemSecrets.get(SYSTEM_TENANT_ID, handle.name);
      const stored = parseStoredSecret(got?.reveal());
      if (stored) return stored;
    }
    if (fallback && fallback.length > 0) return fallback;
    throw new Error(
      `subscription-paddle: '${handle.name}' unresolved — no system-secret set and no factory fallback. Webhook cannot verify until it is configured.`,
    );
  }

  async function hasSecret(
    ctx: HandlerContext,
    handle: ConfigKeyHandle<"text">,
    fallback: string | undefined,
  ): Promise<boolean> {
    if (fallback !== undefined && fallback.length > 0) return true;
    // Existence-only probe on every billing-plans render: must stay un-audited.
    return ctx.services.secrets
      ? await ctx.services.secrets.has(SYSTEM_TENANT_ID, handle.name)
      : false;
  }

  async function baseUrlFor(ctx: HandlerContext): Promise<string> {
    const environment = ctx.config ? await ctx.config(deps.environmentHandle) : undefined;
    return PADDLE_BASE_URLS[environmentOf(environment)];
  }

  return {
    ctx: {
      call: async (ctx, request) =>
        http(
          {
            baseUrl: await baseUrlFor(ctx),
            apiKey: await ctxSecret(ctx, deps.apiKeyHandle, deps.fallback.apiKey, "api-key"),
          },
          request,
        ),
      assertBillingLive: async (ctx, handlerName = "create-checkout-session") => {
        const live = ctx.config ? await ctx.config(deps.billingLiveHandle) : undefined;
        if (live !== true) {
          throw new FeatureDisabledError(SUBSCRIPTION_PADDLE_FEATURE, handlerName);
        }
      },
      isBillingEnabled: async (ctx) => {
        const live = ctx.config ? await ctx.config(deps.billingLiveHandle) : undefined;
        if (live !== true) return false;
        return (
          (await hasSecret(ctx, deps.apiKeyHandle, deps.fallback.apiKey)) &&
          (await hasSecret(ctx, deps.tenantBindingKeyHandle, deps.fallback.tenantBindingKey))
        );
      },
      tenantBindingKey: (ctx) =>
        ctxSecret(
          ctx,
          deps.tenantBindingKeyHandle,
          deps.fallback.tenantBindingKey,
          "tenant-binding-key",
        ),
    },
    webhook: {
      resolveWebhookSecret: (systemSecrets) =>
        webhookSecret(systemSecrets, deps.webhookSecretHandle, deps.fallback.webhookSecret),
      resolveTenantBindingKey: (systemSecrets) =>
        webhookSecret(systemSecrets, deps.tenantBindingKeyHandle, deps.fallback.tenantBindingKey),
    },
    readCheckoutConfig: async (ctx) => {
      const stored = ctx.config ? await ctx.config(deps.clientTokenHandle) : undefined;
      const environment = ctx.config ? await ctx.config(deps.environmentHandle) : undefined;
      const clientToken = stored || deps.fallback.clientToken || null;
      return { clientToken, environment: environmentOf(environment) };
    },
  };
}
