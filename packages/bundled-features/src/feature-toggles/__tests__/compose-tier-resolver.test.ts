// Unit test (no DB) — the composition logic is pure given a tier resolver
// function + a GlobalFeatureToggleRuntime whose in-memory snapshot is set
// directly via .apply(). Pins the semantics documented in
// compose-tier-resolver.ts:
//   - tier-managed toggleables (in SOME tier's `features` list, per the
//     tierResolver(SYSTEM_TENANT_ID) union convention): the global layer
//     only NARROWS what the tier grants — an explicit `false` removes it,
//     no row / `true` leaves the tier's grant untouched, it can never widen
//     beyond what the tenant's own tier includes.
//   - tier-unaware toggleables (in NO tier's `features` list at all, e.g. a
//     pure operator kill-switch like auth-self-registration): membership
//     comes entirely from computeEffectiveFeatures' normal cascade
//     (override ?? toggleableDefault) since no tier ever votes on them.

import { describe, expect, test } from "bun:test";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import {
  createRegistry,
  defineFeature,
  type EffectiveFeaturesResolver,
  SYSTEM_TENANT_ID,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import { composeTierResolverWithGlobalToggles } from "../compose-tier-resolver";
import { GlobalFeatureToggleRuntime } from "../toggle-runtime";

// Never touched by .apply()/.readOverride() — the runtime only does I/O in
// .initialize()/.refresh(), which this test never calls.
const fakeDb = {} as unknown as DbConnection;

// Mirrors publicstatus's real mix: "personal-access-tokens" is Team-tier-
// gated (toggleable, default false), "auth-self-registration" is a global
// kill-switch no tier ever lists (toggleable, default true).
const testRegistry = createRegistry([
  defineFeature("personal-access-tokens", (r) => {
    r.toggleable({ default: false });
  }),
  defineFeature("auth-self-registration", (r) => {
    r.toggleable({ default: true });
  }),
]);

function tierResolverGranting(...features: readonly string[]): EffectiveFeaturesResolver {
  return ((_tenantId: TenantId) => new Set(features)) as EffectiveFeaturesResolver;
}

describe("composeTierResolverWithGlobalToggles", () => {
  test("no override → tier's grant stands", () => {
    const runtime = new GlobalFeatureToggleRuntime(fakeDb, testRegistry);
    const composed = composeTierResolverWithGlobalToggles(
      tierResolverGranting("personal-access-tokens"),
      runtime,
      testRegistry,
    );
    // auth-self-registration joins via the tier-unaware cascade (default
    // true, no override) — see the dedicated tier-unaware tests below.
    expect([...composed("t1" as TenantId)].sort()).toEqual([
      "auth-self-registration",
      "personal-access-tokens",
    ]);
  });

  test("explicit override=false removes a tier-granted feature", () => {
    const runtime = new GlobalFeatureToggleRuntime(fakeDb, testRegistry);
    runtime.apply("personal-access-tokens", false);
    const composed = composeTierResolverWithGlobalToggles(
      tierResolverGranting("personal-access-tokens"),
      runtime,
      testRegistry,
    );
    expect([...composed("t1" as TenantId)]).toEqual(["auth-self-registration"]);
  });

  test("explicit override=true cannot widen a tier-managed feature beyond the tenant's own tier", () => {
    // "personal-access-tokens" IS tier-managed (it's in SOME tier's list,
    // per the SYSTEM_TENANT_ID union), but THIS tenant's own tier grants
    // nothing (e.g. Free). An operator flipping the global row to true
    // must not leak it in — that decision belongs to the tier, not the
    // toggle.
    const tierResolver = ((tenantId: TenantId) =>
      tenantId === SYSTEM_TENANT_ID
        ? new Set(["personal-access-tokens"]) // union of all tiers' features
        : new Set<string>()) as EffectiveFeaturesResolver; // this tenant's (Free) tier grants nothing
    const runtime = new GlobalFeatureToggleRuntime(fakeDb, testRegistry);
    runtime.apply("personal-access-tokens", true);
    const composed = composeTierResolverWithGlobalToggles(tierResolver, runtime, testRegistry);
    // auth-self-registration still joins via the tier-unaware cascade.
    expect([...composed("t1" as TenantId)]).toEqual(["auth-self-registration"]);
  });

  test("a tier-gated toggleable feature with NO override row stays on — no fallback to its own default", () => {
    // Regression pin for the exact bug this composer exists to avoid:
    // a Team-tier feature declared `toggleable({default:false})` must stay
    // granted when the tier includes it and no operator has touched it —
    // computeEffectiveFeatures' cascade would otherwise fall back to
    // `false` the moment feature-toggles is composed in.
    const runtime = new GlobalFeatureToggleRuntime(fakeDb, testRegistry);
    const composed = composeTierResolverWithGlobalToggles(
      tierResolverGranting("personal-access-tokens"),
      runtime,
      testRegistry,
    );
    expect([...composed("t1" as TenantId)].sort()).toEqual([
      "auth-self-registration",
      "personal-access-tokens",
    ]);
  });

  test("tier-unaware toggleable (in no tier's feature list) defaults on via the global cascade", () => {
    const runtime = new GlobalFeatureToggleRuntime(fakeDb, testRegistry);
    const composed = composeTierResolverWithGlobalToggles(
      tierResolverGranting(), // no tier grants anything
      runtime,
      testRegistry,
    );
    expect([...composed("t1" as TenantId)]).toEqual(["auth-self-registration"]);
  });

  test("tier-unaware toggleable — explicit override=false turns it off for every tenant", () => {
    const runtime = new GlobalFeatureToggleRuntime(fakeDb, testRegistry);
    runtime.apply("auth-self-registration", false);
    const composed = composeTierResolverWithGlobalToggles(
      tierResolverGranting(),
      runtime,
      testRegistry,
    );
    expect([...composed("t1" as TenantId)]).toEqual([]);
  });

  test("flip back on restores a tier-unaware feature's default", () => {
    const runtime = new GlobalFeatureToggleRuntime(fakeDb, testRegistry);
    runtime.apply("auth-self-registration", false);
    const composed = composeTierResolverWithGlobalToggles(
      tierResolverGranting(),
      runtime,
      testRegistry,
    );
    expect([...composed("t1" as TenantId)]).toEqual([]);

    runtime.apply("auth-self-registration", true);
    expect([...composed("t1" as TenantId)]).toEqual(["auth-self-registration"]);
  });

  test("preserves the tier resolver's trialGate", async () => {
    const runtime = new GlobalFeatureToggleRuntime(fakeDb, testRegistry);
    const tierResolver = tierResolverGranting();
    const trialGate = async (_tenantId: TenantId, _featureName: string) => true;
    Object.assign(tierResolver, { trialGate });

    const composed = composeTierResolverWithGlobalToggles(tierResolver, runtime, testRegistry);
    expect(composed.trialGate).toBe(trialGate);
  });
});
