// Unit tests for createBillingInfoQueryConfig — stub ctx/deps instead of a
// real DB, see subscription-stripe/__tests__/runtime.test.ts for the same
// stub pattern. Covers the three app-relevant branches: the
// no-prices-early-return (no billing provider configured), that the
// tier resolution is passed through unchanged, and the
// subscription shape validation.

import { describe, expect, mock, test } from "bun:test";
import type { HandlerContext } from "@cosmicdrift/kumiko-framework/engine";
import { createBillingInfoQueryConfig } from "../billing-info-query";

type TestTier = "free" | "starter" | "pro";

function stubCtx(opts: {
  fetchOne: (...args: unknown[]) => Promise<unknown>;
  billingLive?: boolean;
  apiKeySet?: boolean;
  tenantId?: string;
}): HandlerContext {
  return {
    db: { fetchOne: opts.fetchOne },
    user: { tenantId: opts.tenantId ?? "tenant-1" },
    config: async () => opts.billingLive ?? true,
    secrets: { has: async () => opts.apiKeySet ?? true },
    // biome-ignore lint/suspicious/noExplicitAny: minimal HandlerContext stub, see runtime.test.ts precedent
  } as any as HandlerContext; // @cast-boundary test-stub — partial ctx
}

function buildConfig(overrides: { resolveTier?: () => Promise<TestTier> } = {}) {
  return createBillingInfoQueryConfig<TestTier>({
    roles: ["Admin"],
    resolveTier: overrides.resolveTier ?? (async () => "free"),
    getBillingPrices: () => ({ starter: "price_starter", pro: "price_pro" }),
  });
}

describe("createBillingInfoQueryConfig", () => {
  test("no billing prices configured → enabled:false, no DB query", async () => {
    const fetchOne = mock(async () => ({ status: "active", tier: "pro", providerName: "stripe" }));
    const config = createBillingInfoQueryConfig<TestTier>({
      roles: ["Admin"],
      resolveTier: async () => "free",
      getBillingPrices: () => null,
    });
    const ctx = stubCtx({ fetchOne });

    const result = await config.handler({} as never, ctx);

    expect(result).toEqual({ enabled: false, tier: "free", subscription: null, prices: {} });
    expect(fetchOne).not.toHaveBeenCalled();
  });

  test("resolveTier's result is passed through unchanged", async () => {
    const fetchOne = mock(async () => null);
    const config = buildConfig({ resolveTier: async () => "pro" });
    const ctx = stubCtx({ fetchOne });

    const result = await config.handler({} as never, ctx);

    expect(result.tier).toBe("pro");
  });

  test("subscription row with all-string status/tier/providerName is returned", async () => {
    const fetchOne = mock(async () => ({ status: "active", tier: "pro", providerName: "stripe" }));
    const config = buildConfig();
    const ctx = stubCtx({ fetchOne, billingLive: true, apiKeySet: true });

    const result = await config.handler({} as never, ctx);

    expect(result.enabled).toBe(true);
    expect(result.subscription).toEqual({ status: "active", tier: "pro", providerName: "stripe" });
  });

  test("subscription row with a non-string field → null (fails the shape check)", async () => {
    const fetchOne = mock(async () => ({ status: "active", tier: 42, providerName: "stripe" }));
    const config = buildConfig();
    const ctx = stubCtx({ fetchOne });

    const result = await config.handler({} as never, ctx);

    expect(result.subscription).toBeNull();
  });

  test("no subscription row → null", async () => {
    const fetchOne = mock(async () => null);
    const config = buildConfig();
    const ctx = stubCtx({ fetchOne });

    const result = await config.handler({} as never, ctx);

    expect(result.subscription).toBeNull();
  });

  test("access.roles carries the caller's role list through unchanged", () => {
    const config = createBillingInfoQueryConfig<TestTier>({
      roles: ["Admin", "TenantAdmin"],
      resolveTier: async () => "free",
      getBillingPrices: () => null,
    });
    expect(config.access).toEqual({ roles: ["Admin", "TenantAdmin"] });
    expect(config.name).toBe("billing-info");
  });
});
