import { describe, expect, test } from "bun:test";
import type { SessionStore } from "@cosmicdrift/kumiko-bundled-features/auth-foundation";
import { createPersonalAccessTokensFeature } from "@cosmicdrift/kumiko-bundled-features/personal-access-tokens";
import { createSessionsFeature } from "@cosmicdrift/kumiko-bundled-features/sessions";
import type { EffectiveFeaturesResolver } from "@cosmicdrift/kumiko-framework/engine";
import { createTestUser, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import {
  createDevLateBindings,
  createLateBoundEffectiveFeatures,
  wireDevAuth,
} from "../run-dev-app-auth.ts";

const tenant = testTenantId(1);

describe("createLateBoundEffectiveFeatures", () => {
  test("returns undefined when disabled", () => {
    expect(createLateBoundEffectiveFeatures(createDevLateBindings(), false)).toBeUndefined();
  });

  test("throws a boot-order error before the tier resolver is bound, trialGate falls back to false", async () => {
    const wrapper = createLateBoundEffectiveFeatures(createDevLateBindings(), true);
    if (!wrapper) throw new Error("wrapper expected when enabled");
    expect(() => wrapper(tenant)).toThrow(
      "tier-resolver: extension found but resolver not yet built — boot order issue?",
    );
    expect(await wrapper.trialGate?.(tenant, "x")).toBe(false);
  });

  test("delegates resolution and trialGate to the bound resolver", async () => {
    const lateBindings = createDevLateBindings();
    const wrapper = createLateBoundEffectiveFeatures(lateBindings, true);
    if (!wrapper) throw new Error("wrapper expected when enabled");
    const seenTenants: string[] = [];
    const gateCalls: Array<[string, string]> = [];
    const fake: EffectiveFeaturesResolver = Object.assign(
      (tenantId: typeof tenant): ReadonlySet<string> => {
        seenTenants.push(tenantId);
        return new Set(["a", "b"]);
      },
      {
        trialGate: (tenantId: typeof tenant, featureName: string): Promise<boolean> => {
          gateCalls.push([tenantId, featureName]);
          return Promise.resolve(true);
        },
      },
    );
    lateBindings.tierResolver = fake;

    expect([...wrapper(tenant)]).toEqual(["a", "b"]);
    expect(seenTenants).toEqual([tenant]);
    expect(await wrapper.trialGate?.(tenant, "feat")).toBe(true);
    expect(gateCalls).toEqual([[tenant, "feat"]]);
  });

  test("trialGate resolves to false when the bound resolver has none", async () => {
    const lateBindings = createDevLateBindings();
    const wrapper = createLateBoundEffectiveFeatures(lateBindings, true);
    if (!wrapper) throw new Error("wrapper expected when enabled");
    lateBindings.tierResolver = Object.assign((): ReadonlySet<string> => new Set<string>(), {});
    expect(await wrapper.trialGate?.(tenant, "x")).toBe(false);
  });
});

describe("wireDevAuth late-bound auth fragments", () => {
  const envSource: Record<string, string | undefined> = {};
  const effectiveAuth = {
    admin: { email: "a@example.eu", password: "pw", displayName: "Admin", memberships: [] },
  };
  const sessionsOnly = { features: [createSessionsFeature()], effectiveAuth, envSource };

  function fakeSessionStore(): SessionStore {
    return {
      creator: (user, meta) => Promise.resolve(`sid:${user.id}:${meta.ip}:${meta.userAgent}`),
      revoker: () => Promise.resolve(),
      checker: (sid, userId) =>
        Promise.resolve({ status: "live", roles: [`${sid}/${userId}`] } as const),
      massRevoker: () => Promise.resolve(0),
      revokeAllOthers: () => Promise.resolve(0),
    };
  }

  test("session callbacks throw before the store is bound, then delegate with the same arguments", async () => {
    const lateBindings = createDevLateBindings();
    const fragment = wireDevAuth(sessionsOnly, undefined, true, lateBindings).sessionAuthFragment;
    if (!fragment) throw new Error("sessionAuthFragment expected");
    const user = createTestUser();
    const meta = { ip: "203.0.113.7", userAgent: "ua" };
    const message = "[runDevApp] sessionStore accessed before onAfterSetup";

    expect(() => fragment.sessionCreator(user, meta)).toThrow(message);
    expect(() => fragment.sessionRevoker("sid-1")).toThrow(message);
    expect(() => fragment.sessionChecker("sid-1", user.id)).toThrow(message);

    lateBindings.sessionStore = fakeSessionStore();
    expect(await fragment.sessionCreator(user, meta)).toBe(`sid:${user.id}:203.0.113.7:ua`);
    expect(await fragment.sessionRevoker("sid-1")).toBeUndefined();
    expect(await fragment.sessionChecker("sid-1", user.id)).toEqual({
      status: "live",
      roles: [`sid-1/${user.id}`],
    });
  });

  test("sessionAuthFragment is undefined without a mounted provider or without auth", () => {
    expect(
      wireDevAuth(sessionsOnly, undefined, false, createDevLateBindings()).sessionAuthFragment,
    ).toBeUndefined();
    expect(
      wireDevAuth(
        { ...sessionsOnly, effectiveAuth: undefined },
        undefined,
        true,
        createDevLateBindings(),
      ).sessionAuthFragment,
    ).toBeUndefined();
  });

  test("PAT tokenVerifier throws before binding, then returns the bound verifier's result", async () => {
    const lateBindings = createDevLateBindings();
    const config = {
      features: [createPersonalAccessTokensFeature({ scopes: {} })],
      effectiveAuth,
      envSource,
    };
    const fragment = wireDevAuth(config, undefined, false, lateBindings).patAuthFragment;
    if (!fragment) throw new Error("patAuthFragment expected");
    expect(() => fragment.tokenVerifier("pat_abc")).toThrow(
      "[runDevApp] token-verifier accessed before onAfterSetup",
    );

    const user = createTestUser();
    lateBindings.tokenVerifier = (rawToken) =>
      Promise.resolve(rawToken === "pat_abc" ? user : null);
    expect(await fragment.tokenVerifier("pat_abc")).toBe(user);
    expect(await fragment.tokenVerifier("other")).toBeNull();
  });

  test("patAuthFragment is undefined without the PAT feature", () => {
    expect(
      wireDevAuth(sessionsOnly, undefined, true, createDevLateBindings()).patAuthFragment,
    ).toBeUndefined();
  });
});
