// Unit-Tests für die Runtime-Key/Flag-Resolution (runtime.ts) — das Herz
// des v2-Pivots weg von mount-time-Closures. Stub-ctx/SecretsContext
// statt echter DB: wir testen die Resolution-Logik (secrets→fallback→throw,
// billing-live-Gate, Client-Memoization), nicht die secrets-Persistenz
// (das deckt der Integration-Test ab).

import { describe, expect, test } from "bun:test";
import {
  type ConfigKeyHandle,
  type HandlerContext,
  qn,
  toKebab,
} from "@cosmicdrift/kumiko-framework/engine";
import { FeatureDisabledError, UnconfiguredError } from "@cosmicdrift/kumiko-framework/errors";
import { createSecret, type SecretsContext } from "@cosmicdrift/kumiko-framework/secrets";
import Stripe from "stripe";
import {
  STRIPE_API_KEY_CONFIG,
  STRIPE_BILLING_LIVE_CONFIG,
  STRIPE_WEBHOOK_SECRET_CONFIG,
  SUBSCRIPTION_STRIPE_FEATURE,
} from "../constants";
import { createStripeClientCache, createStripeRuntimes } from "../runtime";

// Handle-Namen aus den kanonischen Konstanten + demselben Qualifier ableiten,
// den r.config zur Build-Zeit anwendet (define-feature.ts: qn(toKebab(feature),
// "config", toKebab(shortKey))). Eine hand-redeklarierte Fixture konnte still
// von der Produktion driften (#421/2) — diese Ableitung macht das unmöglich.
const configHandleName = (shortKey: string): string =>
  qn(toKebab(SUBSCRIPTION_STRIPE_FEATURE), "config", toKebab(shortKey));

const API_KEY_HANDLE: ConfigKeyHandle<"text"> = {
  name: configHandleName(STRIPE_API_KEY_CONFIG),
  type: "text",
};
const WEBHOOK_SECRET_HANDLE: ConfigKeyHandle<"text"> = {
  name: configHandleName(STRIPE_WEBHOOK_SECRET_CONFIG),
  type: "text",
};
const BILLING_LIVE_HANDLE: ConfigKeyHandle<"boolean"> = {
  name: configHandleName(STRIPE_BILLING_LIVE_CONFIG),
  type: "boolean",
};

/** Stub-SecretsContext: liest aus einer in-memory-map, matcht per
 *  qualified-name. backing:"secrets" persistiert config-Werte JSON-
 *  serialisiert — der Stub spiegelt das, damit der Runtime-parseStoredSecret
 *  denselben Pfad nimmt wie gegen den echten Store. Ignoriert auditCtx. */
function stubSecrets(values: Record<string, string>): SecretsContext {
  const nameOf = (k: string | { readonly name: string }): string =>
    typeof k === "string" ? k : k.name;
  return {
    get: async (_tenantId, key) => {
      const value = values[nameOf(key)];
      return value === undefined ? undefined : createSecret(JSON.stringify(value));
    },
    has: async (_tenantId, key) => values[nameOf(key)] !== undefined,
    set: async () => undefined,
    delete: async () => false,
  };
}

/** Wie stubSecrets, aber speichert den Wert ROH (kein JSON.stringify) — um
 *  parseStoredSecret's Fehlerpfad zu treffen: ein Credential, das der Store
 *  un-JSON-kodiert zurückgibt (Korruption oder ein außerhalb des
 *  backing:"secrets"-Roundtrips geschriebener Wert) muss laut failen, nicht
 *  still Müll liefern. */
function rawSecretsStub(values: Record<string, string>): SecretsContext {
  const nameOf = (k: string | { readonly name: string }): string =>
    typeof k === "string" ? k : k.name;
  return {
    get: async (_tenantId, key) => {
      const value = values[nameOf(key)];
      return value === undefined ? undefined : createSecret(value); // RAW, not JSON
    },
    has: async (_tenantId, key) => values[nameOf(key)] !== undefined,
    set: async () => undefined,
    delete: async () => false,
  };
}

/** Minimaler HandlerContext-Stub mit nur den Feldern, die die ctx-
 *  Resolution liest (secrets, _userId für audit, config). */
function stubCtx(opts: { secrets?: SecretsContext; billingLive?: boolean }): HandlerContext {
  return {
    secrets: opts.secrets,
    _userId: "tester",
    // Key-aware: antwortet NUR auf das billing-live-Handle. Liest
    // assertBillingLive versehentlich einen anderen Config-Key, kommt undefined
    // zurück → Gate schließt → der "passes when true"-Test schlägt fehl (#421/3).
    config: async (handle: ConfigKeyHandle<"boolean">) =>
      handle.name === BILLING_LIVE_HANDLE.name ? opts.billingLive : undefined,
  } as unknown as HandlerContext; // @cast-boundary test-stub — partial ctx
}

function makeRuntimes(fallback: { apiKey?: string; webhookSecret?: string } = {}) {
  return createStripeRuntimes({
    apiKeyHandle: API_KEY_HANDLE,
    webhookSecretHandle: WEBHOOK_SECRET_HANDLE,
    billingLiveHandle: BILLING_LIVE_HANDLE,
    fallback,
  });
}

// =============================================================================
// createStripeClientCache
// =============================================================================

describe("createStripeClientCache", () => {
  test("memoizes by api-key — same key → same instance, rotated key → new instance", () => {
    const cache = createStripeClientCache();
    const a1 = cache("sk_test_aaa");
    const a2 = cache("sk_test_aaa");
    const b1 = cache("sk_test_bbb");

    expect(a1).toBeInstanceOf(Stripe);
    expect(a2).toBe(a1); // steady-state reuses one client per key
    expect(b1).not.toBe(a1); // rotation builds a fresh client
  });
});

// =============================================================================
// ctx-runtime: api-key resolution (post-tenant, audited)
// =============================================================================

describe("StripeCtxRuntime.clientForCtx", () => {
  test("reads api-key from system-secrets → builds a client", async () => {
    const rt = makeRuntimes();
    const ctx = stubCtx({ secrets: stubSecrets({ [API_KEY_HANDLE.name]: "sk_test_from_secret" }) });
    const client = await rt.ctx.clientForCtx(ctx);
    expect(client).toBeInstanceOf(Stripe);
  });

  test("secret takes precedence over factory-fallback; rotating the secret → new client", async () => {
    const rt = makeRuntimes({ apiKey: "sk_test_fallback" });
    const values: Record<string, string> = { [API_KEY_HANDLE.name]: "sk_test_v1" };
    const ctx = stubCtx({ secrets: stubSecrets(values) });

    const first = await rt.ctx.clientForCtx(ctx);
    const again = await rt.ctx.clientForCtx(ctx);
    expect(again).toBe(first); // same secret → memoized

    values[API_KEY_HANDLE.name] = "sk_test_v2"; // operator rotates the secret
    const afterRotation = await rt.ctx.clientForCtx(ctx);
    expect(afterRotation).not.toBe(first); // runtime re-read picked up the new key
  });

  test("falls back to factory api-key when no secret is set", async () => {
    const rt = makeRuntimes({ apiKey: "sk_test_fallback" });
    const ctx = stubCtx({ secrets: stubSecrets({}) });
    const client = await rt.ctx.clientForCtx(ctx);
    expect(client).toBeInstanceOf(Stripe);
  });

  test("throws UnconfiguredError when neither secret nor fallback is set", async () => {
    const rt = makeRuntimes();
    const ctx = stubCtx({ secrets: stubSecrets({}) });
    await expect(rt.ctx.clientForCtx(ctx)).rejects.toBeInstanceOf(UnconfiguredError);
  });

  test("throws loudly on a malformed (non-JSON) stored credential (#393/2)", async () => {
    // The store round-trips backing:"secrets" values JSON-encoded; a raw,
    // un-quoted value reaching parseStoredSecret means corruption — it must
    // throw, not silently fall through to undefined/fallback.
    const rt = makeRuntimes({ apiKey: "sk_test_fallback" });
    const ctx = stubCtx({
      secrets: rawSecretsStub({ [API_KEY_HANDLE.name]: "sk_test_raw_unquoted" }),
    });
    await expect(rt.ctx.clientForCtx(ctx)).rejects.toThrow(
      /Invalid JSON in subscription-stripe credential/,
    );
  });
});

// =============================================================================
// ctx-runtime: billing-live gate (#104 invariant)
// =============================================================================

describe("StripeCtxRuntime.assertBillingLive", () => {
  test("passes when billing-live config is true", async () => {
    const rt = makeRuntimes();
    await expect(rt.ctx.assertBillingLive(stubCtx({ billingLive: true }))).resolves.toBeUndefined();
  });

  test("throws FeatureDisabledError when billing-live is false", async () => {
    const rt = makeRuntimes();
    await expect(rt.ctx.assertBillingLive(stubCtx({ billingLive: false }))).rejects.toBeInstanceOf(
      FeatureDisabledError,
    );
  });

  test("throws FeatureDisabledError when billing-live is undefined (default-off)", async () => {
    const rt = makeRuntimes();
    await expect(
      rt.ctx.assertBillingLive(stubCtx({ billingLive: undefined })),
    ).rejects.toBeInstanceOf(FeatureDisabledError);
  });
});

// =============================================================================
// webhook-runtime: pre-tenant resolution (raw, un-audited)
// =============================================================================

describe("StripeWebhookRuntime.resolve", () => {
  test("resolves client + webhook-secret from system-secrets", async () => {
    const rt = makeRuntimes();
    const secrets = stubSecrets({
      [API_KEY_HANDLE.name]: "sk_test_wh",
      [WEBHOOK_SECRET_HANDLE.name]: "whsec_runtime",
    });
    const { stripe, webhookSecret } = await rt.webhook.resolve(secrets);
    expect(stripe).toBeInstanceOf(Stripe);
    expect(webhookSecret).toBe("whsec_runtime");
  });

  test("falls back to factory keys when no system-secrets passed", async () => {
    const rt = makeRuntimes({ apiKey: "sk_test_fb", webhookSecret: "whsec_fb" });
    const { webhookSecret } = await rt.webhook.resolve(undefined);
    expect(webhookSecret).toBe("whsec_fb");
  });

  test("system-secret wins over fallback (rotation without redeploy)", async () => {
    const rt = makeRuntimes({ webhookSecret: "whsec_stale_env" });
    const secrets = stubSecrets({
      [API_KEY_HANDLE.name]: "sk_test_x",
      [WEBHOOK_SECRET_HANDLE.name]: "whsec_rotated",
    });
    const { webhookSecret } = await rt.webhook.resolve(secrets);
    expect(webhookSecret).toBe("whsec_rotated");
  });

  test("throws when a key is unresolved (no secret, no fallback)", async () => {
    const rt = makeRuntimes({ apiKey: "sk_test_only" }); // webhook-secret missing
    await expect(rt.webhook.resolve(stubSecrets({}))).rejects.toThrow(/webhook-secret.*unresolved/);
  });
});
