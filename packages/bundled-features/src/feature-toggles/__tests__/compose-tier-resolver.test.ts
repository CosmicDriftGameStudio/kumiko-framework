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

// Mirrors tier-engine's real resolver contract (tier-engine/feature.ts's
// mergeAlwaysOn calls): SYSTEM_TENANT_ID always includes at least the
// always-on features merged in, even when zero tiers grant anything —
// tests exercising "no tier grants this feature" must still see a non-empty
// SYSTEM_TENANT_ID union, exactly like a real app always has.
function tierResolverGranting(...features: readonly string[]): EffectiveFeaturesResolver {
  return ((tenantId: TenantId) =>
    tenantId === SYSTEM_TENANT_ID
      ? new Set([...features, "always-on-stand-in"])
      : new Set(features)) as EffectiveFeaturesResolver;
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

  test("kumiko-framework#1479/2: an empty SYSTEM_TENANT_ID union throws instead of silently disabling all tier-gating", () => {
    // A tierResolver that doesn't implement the SYSTEM_TENANT_ID convention
    // at all (e.g. always returns per-tenant grants, never the union) —
    // the old code would treat this as "zero tier-managed features", so
    // EVERY toggleable feature falls through to the tier-unaware cascade
    // and tier-gating is silently defeated.
    const brokenTierResolver = ((_tenantId: TenantId) =>
      new Set<string>()) as EffectiveFeaturesResolver;
    const runtime = new GlobalFeatureToggleRuntime(fakeDb, testRegistry);
    const composed = composeTierResolverWithGlobalToggles(
      brokenTierResolver,
      runtime,
      testRegistry,
    );
    expect(() => composed("t1" as TenantId)).toThrow(/SYSTEM_TENANT_ID/);
  });

  test("kumiko-framework#1479/2: tierManaged is computed lazily — a resolver not ready at compose-time is fine as long as it's ready by first call", () => {
    let ready = false;
    const lateBoundResolver = ((tenantId: TenantId) => {
      if (!ready) throw new Error("tierResolver not wired yet");
      return tenantId === SYSTEM_TENANT_ID
        ? new Set(["personal-access-tokens"])
        : new Set<string>();
    }) as EffectiveFeaturesResolver;
    const runtime = new GlobalFeatureToggleRuntime(fakeDb, testRegistry);
    // Composing must NOT eagerly call tierResolver(SYSTEM_TENANT_ID) — the
    // late-bound holder pattern (run-dev-app.ts) builds the real resolver
    // only after composeTierResolverWithGlobalToggles has already run.
    const composed = composeTierResolverWithGlobalToggles(lateBoundResolver, runtime, testRegistry);
    ready = true;
    expect(() => composed("t1" as TenantId)).not.toThrow();
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

describe("composeTierResolverWithGlobalToggles — non-toggleable + requires() interaction", () => {
  // Separate registry from the toggleable-only one above: a non-toggleable
  // (always-on) feature and a toggleable one that requires() a tier-managed
  // feature. Kept in its own describe so these additions can't shift the
  // exact-array assertions in the suite above.
  const registry = createRegistry([
    defineFeature("personal-access-tokens", (r) => {
      r.toggleable({ default: false });
    }),
    // Always-on, non-toggleable — no `r.toggleable()` call at all.
    defineFeature("tenant", () => {}),
    // Tier-unaware (no tier ever lists it) but depends on a tier-managed
    // feature — its own eligibility must still respect that dependency.
    defineFeature("pat-companion", (r) => {
      r.toggleable({ default: true });
      r.requires("personal-access-tokens");
    }),
  ]);

  test("a non-toggleable feature stays granted even when the real tierResolver's mergeAlwaysOn puts it in the SYSTEM union", () => {
    // Mirrors tier-engine's real mergeAlwaysOn: always-on features are
    // merged into every tenant's set, not just the SYSTEM_TENANT_ID union —
    // otherwise composeTierResolverWithGlobalToggles' `!tierManaged.has()`
    // filter would incorrectly drop it (tier-managed but absent from this
    // tenant's own tier subset).
    const tierResolver = ((tenantId: TenantId) =>
      tenantId === SYSTEM_TENANT_ID
        ? new Set(["tenant", "personal-access-tokens"])
        : new Set(["tenant"])) as EffectiveFeaturesResolver;
    const runtime = new GlobalFeatureToggleRuntime(fakeDb, registry);
    const composed = composeTierResolverWithGlobalToggles(tierResolver, runtime, registry);
    expect([...composed("t1" as TenantId)]).toContain("tenant");
  });

  test("a tier-unaware feature requiring a tier-managed feature the tenant's tier doesn't grant is excluded", () => {
    // "pat-companion" is tier-unaware (no tier ever lists it) but requires
    // "personal-access-tokens", which IS tier-managed and this tenant's own
    // tier grants nothing — the dependency must not silently resolve true.
    const tierResolver = ((tenantId: TenantId) =>
      tenantId === SYSTEM_TENANT_ID
        ? new Set(["personal-access-tokens"])
        : new Set<string>()) as EffectiveFeaturesResolver;
    const runtime = new GlobalFeatureToggleRuntime(fakeDb, registry);
    const composed = composeTierResolverWithGlobalToggles(tierResolver, runtime, registry);
    expect([...composed("t1" as TenantId)]).not.toContain("pat-companion");
  });

  test("kumiko-framework#1471/1: a tier-granted feature whose requires() dependency is globally disabled is excluded too", () => {
    // "pat-companion" IS in this tenant's tier grant this time (unlike the
    // test above) — the tenant's tier says yes, but its requires()
    // dependency "personal-access-tokens" is killed globally via override.
    // The old code only checked `readOverride(name) !== false` on
    // "pat-companion" itself (which has no override, so it stayed) without
    // ever re-running the requires() cascade over the tier-granted set —
    // exactly the class of bug #1471/1 describes (channel-email staying up
    // after its `delivery` dependency is killed).
    const tierResolver = ((tenantId: TenantId) =>
      tenantId === SYSTEM_TENANT_ID
        ? new Set(["personal-access-tokens", "pat-companion"])
        : new Set(["personal-access-tokens", "pat-companion"])) as EffectiveFeaturesResolver;
    const runtime = new GlobalFeatureToggleRuntime(fakeDb, registry);
    runtime.apply("personal-access-tokens", false);
    const composed = composeTierResolverWithGlobalToggles(tierResolver, runtime, registry);
    const result = [...composed("t1" as TenantId)];
    expect(result).not.toContain("personal-access-tokens");
    expect(result).not.toContain("pat-companion");
  });

  test("kumiko-framework#1471/2: a global override cannot disable a non-toggleable (always-on) feature", () => {
    // "tenant" has no r.toggleable() call at all — computeEffectiveFeatures'
    // Rule 1 says non-toggleable features ignore overrides entirely. The old
    // code applied `readOverride(name) !== false` to every name in tierSet
    // with no toggleability check, so a stray override row (seed script,
    // ops SQL, or a feature that used to be toggleable and had `r.toggleable()`
    // removed) could disable an always-on feature outright.
    const tierResolver = ((tenantId: TenantId) =>
      tenantId === SYSTEM_TENANT_ID
        ? new Set(["tenant"])
        : new Set(["tenant"])) as EffectiveFeaturesResolver;
    const runtime = new GlobalFeatureToggleRuntime(fakeDb, registry);
    runtime.apply("tenant", false);
    const composed = composeTierResolverWithGlobalToggles(tierResolver, runtime, registry);
    expect([...composed("t1" as TenantId)]).toContain("tenant");
  });
});
