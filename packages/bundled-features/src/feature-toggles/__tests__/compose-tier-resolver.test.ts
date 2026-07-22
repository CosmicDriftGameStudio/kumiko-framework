// Unit test (no DB) — the composition logic is pure given a tier resolver
// function + a GlobalFeatureToggleRuntime whose in-memory snapshot is set
// directly via .apply(). Pins the semantics documented in
// compose-tier-resolver.ts: the global layer only NARROWS what the tier
// grants (explicit `false` removes it), it never falls back to a
// toggleable feature's own default and never widens beyond the tier.

import { describe, expect, test } from "bun:test";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import type {
  EffectiveFeaturesResolver,
  Registry,
  TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import { composeTierResolverWithGlobalToggles } from "../compose-tier-resolver";
import { GlobalFeatureToggleRuntime } from "../toggle-runtime";

// Never touched by .apply()/.readOverride() — the runtime only does I/O in
// .initialize()/.refresh(), which this test never calls.
const fakeDb = {} as unknown as DbConnection;
const fakeRegistry = {} as unknown as Registry;

function tierResolverGranting(...features: readonly string[]): EffectiveFeaturesResolver {
  return ((_tenantId: TenantId) => new Set(features)) as EffectiveFeaturesResolver;
}

describe("composeTierResolverWithGlobalToggles", () => {
  test("no override → tier's grant stands", () => {
    const runtime = new GlobalFeatureToggleRuntime(fakeDb, fakeRegistry);
    const composed = composeTierResolverWithGlobalToggles(
      tierResolverGranting("auth-self-registration", "personal-access-tokens"),
      runtime,
    );
    expect([...composed("t1" as TenantId)].sort()).toEqual([
      "auth-self-registration",
      "personal-access-tokens",
    ]);
  });

  test("explicit override=false removes a tier-granted feature", () => {
    const runtime = new GlobalFeatureToggleRuntime(fakeDb, fakeRegistry);
    runtime.apply("auth-self-registration", false);
    const composed = composeTierResolverWithGlobalToggles(
      tierResolverGranting("auth-self-registration", "personal-access-tokens"),
      runtime,
    );
    expect([...composed("t1" as TenantId)]).toEqual(["personal-access-tokens"]);
  });

  test("explicit override=true is a no-op — cannot widen beyond the tier's grant", () => {
    const runtime = new GlobalFeatureToggleRuntime(fakeDb, fakeRegistry);
    runtime.apply("some-other-feature", true);
    const composed = composeTierResolverWithGlobalToggles(
      tierResolverGranting("auth-self-registration"),
      runtime,
    );
    expect([...composed("t1" as TenantId)]).toEqual(["auth-self-registration"]);
  });

  test("a tier-gated toggleable feature with NO override row stays on — no fallback to its own default", () => {
    // Regression pin for the exact bug this composer exists to avoid:
    // a Team-tier feature declared `toggleable({default:false})` must stay
    // granted when the tier includes it and no operator has touched it —
    // computeEffectiveFeatures' cascade would otherwise fall back to
    // `false` the moment feature-toggles is composed in.
    const runtime = new GlobalFeatureToggleRuntime(fakeDb, fakeRegistry);
    const composed = composeTierResolverWithGlobalToggles(
      tierResolverGranting("personal-access-tokens"),
      runtime,
    );
    expect([...composed("t1" as TenantId)]).toEqual(["personal-access-tokens"]);
  });

  test("flip back on restores the tier's grant", () => {
    const runtime = new GlobalFeatureToggleRuntime(fakeDb, fakeRegistry);
    runtime.apply("auth-self-registration", false);
    const composed = composeTierResolverWithGlobalToggles(
      tierResolverGranting("auth-self-registration"),
      runtime,
    );
    expect([...composed("t1" as TenantId)]).toEqual([]);

    runtime.apply("auth-self-registration", true);
    expect([...composed("t1" as TenantId)]).toEqual(["auth-self-registration"]);
  });

  test("preserves the tier resolver's trialGate", async () => {
    const runtime = new GlobalFeatureToggleRuntime(fakeDb, fakeRegistry);
    const tierResolver = tierResolverGranting();
    const trialGate = async (_tenantId: TenantId, _featureName: string) => true;
    Object.assign(tierResolver, { trialGate });

    const composed = composeTierResolverWithGlobalToggles(tierResolver, runtime);
    expect(composed.trialGate).toBe(trialGate);
  });
});
