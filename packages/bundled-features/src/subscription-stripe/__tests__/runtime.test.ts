// Unit tests for runtime key/flag resolution (runtime.ts), the core of the
// v2 pivot away from mount-time closures. Stub ctx/SecretsContext instead of a
// real database: these tests cover resolution (secrets→fallback→throw), the
// billing-live gate, and client memoization, not secret persistence (covered by
// the integration test).

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
} from "../constants.ts";
import { createStripeClientCache, createStripeRuntimes } from "../runtime.ts";

// Derive handle names from the canonical constants and the same qualifier
// applied by r.config at build time (define-feature.ts: qn(toKebab(feature),
// "config", toKebab(shortKey))). A manually redeclared fixture could silently
// drift from production; deriving it this way makes that impossible.
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

/** Stub SecretsContext: reads from an in-memory map and matches by
 *  qualified name. backing:"secrets" persists config values as JSON, so the
 *  default mirrors that behavior and makes the runtime parseStoredSecret take
 *  the same path as it does with the real store.
 *  `raw: true` stores values without serialization to exercise
 *  parseStoredSecret's error path: a credential returned by the store without
 *  JSON encoding (because of corruption or because it was written outside the
 *  backing:"secrets" round trip) must fail rather than silently return garbage.
 *  Ignores auditCtx. */
function stubSecrets(
  values: Record<string, string>,
  opts?: { readonly raw?: boolean },
): SecretsContext {
  const nameOf = (k: string | { readonly name: string }): string =>
    typeof k === "string" ? k : k.name;
  return {
    get: async (_tenantId, key) => {
      const value = values[nameOf(key)];
      if (value === undefined) return undefined;
      return createSecret(opts?.raw ? value : JSON.stringify(value));
    },
    has: async (_tenantId, key) => values[nameOf(key)] !== undefined,
    set: async () => undefined,
    delete: async () => false,
    withRunner: () => {
      throw new Error("withRunner is not used by this test");
    },
  };
}

/** Minimal HandlerContext stub with only the fields the ctx resolution
 *  reads (services.secrets, user for the audit, config). */
function stubCtx(opts: { secrets?: SecretsContext; billingLive?: boolean }): HandlerContext {
  return {
    services: { secrets: opts.secrets, extensions: {} },
    user: { id: "tester" },
    // Key-aware: responds ONLY to the billing-live handle. If assertBillingLive
    // accidentally reads another config key, it returns undefined, the gate
    // closes, and the "passes when true" test fails.
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
      secrets: stubSecrets({ [API_KEY_HANDLE.name]: "sk_test_raw_unquoted" }, { raw: true }),
    });
    await expect(rt.ctx.clientForCtx(ctx)).rejects.toThrow(
      "subscription-stripe credential (backing:secrets) is not valid JSON",
    );
  });

  test("the malformed-credential error does not leak the stored value", async () => {
    const rt = makeRuntimes();
    const secrets = stubSecrets(
      { [API_KEY_HANDLE.name]: "sk_test_x", [WEBHOOK_SECRET_HANDLE.name]: "whsec_AbC123" },
      { raw: true },
    );
    const failure = await rt.webhook.resolve(secrets).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    if (!(failure instanceof Error)) return;
    expect(failure.message).not.toContain("sk_test_x");
    expect(failure.message).not.toContain("whsec_AbC123");
    expect(failure.cause).toBeUndefined();
  });
});

// =============================================================================
// ctx-runtime: billing-live gate
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

describe("StripeCtxRuntime.isBillingEnabled", () => {
  test("false when billing-live is off, regardless of api-key presence", async () => {
    const rt = makeRuntimes({ apiKey: "sk_test_fallback" });
    expect(await rt.ctx.isBillingEnabled(stubCtx({ billingLive: false }))).toBe(false);
  });

  test("true when billing-live is on and a fallback api-key is set", async () => {
    const rt = makeRuntimes({ apiKey: "sk_test_fallback" });
    expect(await rt.ctx.isBillingEnabled(stubCtx({ billingLive: true }))).toBe(true);
  });

  test("true when billing-live is on and ctx.secrets has the api-key, without reading its value", async () => {
    const rt = makeRuntimes();
    let getCalled = false;
    const secrets = stubSecrets({ [API_KEY_HANDLE.name]: "sk_test_present" });
    const spyingSecrets: SecretsContext = {
      ...secrets,
      get: async (...args) => {
        getCalled = true;
        return secrets.get(...args);
      },
    };
    expect(
      await rt.ctx.isBillingEnabled(stubCtx({ billingLive: true, secrets: spyingSecrets })),
    ).toBe(true);
    expect(getCalled).toBe(false);
  });

  test("false when billing-live is on but no api-key is configured anywhere", async () => {
    const rt = makeRuntimes();
    const secrets = stubSecrets({});
    expect(await rt.ctx.isBillingEnabled(stubCtx({ billingLive: true, secrets }))).toBe(false);
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
