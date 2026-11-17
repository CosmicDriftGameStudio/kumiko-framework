import { describe, expect, test } from "bun:test";
import { createAuthEmailPasswordFeature } from "@cosmicdrift/kumiko-bundled-features/auth-email-password";
import { createAuthFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/auth-foundation";
import { createComplianceProfilesFeature } from "@cosmicdrift/kumiko-bundled-features/compliance-profiles";
import { createConfigFeature } from "@cosmicdrift/kumiko-bundled-features/config";
import { createCryptoShreddingFeature } from "@cosmicdrift/kumiko-bundled-features/crypto-shredding";
import { createDataRetentionFeature } from "@cosmicdrift/kumiko-bundled-features/data-retention";
import { createPersonalAccessTokensFeature } from "@cosmicdrift/kumiko-bundled-features/personal-access-tokens";
import { createSessionsFeature } from "@cosmicdrift/kumiko-bundled-features/sessions";
import { createTenantFeature } from "@cosmicdrift/kumiko-bundled-features/tenant";
import type { CreateTierEngineOptions } from "@cosmicdrift/kumiko-bundled-features/tier-engine";
import { createUserFeature } from "@cosmicdrift/kumiko-bundled-features/user";
import { createUserDataRightsFeature } from "@cosmicdrift/kumiko-bundled-features/user-data-rights";
import { createUserDataRightsDefaultsFeature } from "@cosmicdrift/kumiko-bundled-features/user-data-rights-defaults";
import { createUserProfileFeature } from "@cosmicdrift/kumiko-bundled-features/user-profile";
import {
  createRegistry,
  defineFeature,
  type FeatureDefinition,
  SECURITY_BASELINE_FEATURE_NAMES,
  validateBoot,
} from "@cosmicdrift/kumiko-framework/engine";
import { composeFeatures } from "@cosmicdrift/kumiko-server-runtime/compose-features";
import { rolesOf } from "@cosmicdrift/kumiko-testing/helpers";
import {
  composeAuthStack,
  composeFileStack,
  composeGdprStack,
  composeIdentityStack,
  composeMailStack,
  composeOpsStack,
  composePagesStack,
  composeRendererStack,
  composeSaasStack,
  composeSecurityStack,
  composeUserDataRightsStack,
  stackFeatureNames,
} from "../compose-stacks.ts";

const TEST_MFA = {
  setupTokenSecret: "compose-stacks-mfa-setup-secret-at-least-32b!!",
  challengeTokenSecret: "compose-stacks-mfa-challenge-secret-32b!!",
  issuer: "Kumiko ComposeStacks",
} as const;

describe("composeStacks", () => {
  test("composeRendererStack → template-resolver, renderer-foundation, renderer-mail-html", () => {
    expect(stackFeatureNames(composeRendererStack())).toEqual([
      "template-resolver",
      "renderer-foundation",
      "renderer-mail-html",
    ]);
  });

  test("composeRendererStack({ templateResolver }) reaches the template-resolver write access", () => {
    const upsertTenantRoles = (features: readonly FeatureDefinition[]): readonly string[] =>
      rolesOf(
        features.find((f) => f.name === "template-resolver")?.writeHandlers["upsert-tenant"]
          ?.access,
      );
    const unlocked = composeRendererStack({
      templateResolver: {
        tenantEditable: [
          { kind: "mail", slug: "status-update", access: { roles: ["TenantAdmin"] } },
        ],
      },
    });
    expect(upsertTenantRoles(unlocked)).toContain("TenantAdmin");
    expect(upsertTenantRoles(composeRendererStack())).toEqual(["SystemAdmin"]);
  });

  test("composePagesStack → legal-pages (template-resolver comes from the renderer stack)", () => {
    expect(stackFeatureNames(composePagesStack())).toEqual(["legal-pages"]);
  });

  test("composeMailStack mounts foundation + selected transports", () => {
    expect(stackFeatureNames(composeMailStack({ transports: ["inmemory", "smtp"] }))).toEqual([
      "mail-foundation",
      "mail-transport-inmemory",
      "mail-transport-smtp",
    ]);
  });

  test("composeFileStack mounts foundation + providers + files entity", () => {
    expect(stackFeatureNames(composeFileStack({ providers: ["inmemory", "s3"] }))).toEqual([
      "file-foundation",
      "file-provider-inmemory",
      "file-provider-s3",
      "files",
    ]);
  });

  test("composePagesStack({ terms }) also serves the terms routes", () => {
    const paths = (feature: FeatureDefinition | undefined): string[] =>
      Object.values(feature?.httpRoutes ?? {}).map((route) => route.path);
    const withTerms = paths(composePagesStack({ terms: true })[0]);
    const withoutTerms = paths(composePagesStack()[0]);
    expect(withTerms).toContain("/legal/terms");
    expect(withoutTerms).not.toContain("/legal/terms");
  });

  test("composeGdprStack({ access }) sets the compliance-profiles handler roles", () => {
    const profiles = (features: readonly FeatureDefinition[]): FeatureDefinition | undefined =>
      features.find((f) => f.name === "compliance-profiles");
    const narrowed = profiles(composeGdprStack({ access: ["SystemAdmin"] }));
    const defaulted = profiles(composeGdprStack());
    const rolesOfFirstWrite = (f: FeatureDefinition | undefined): readonly string[] =>
      rolesOf(Object.values(f?.writeHandlers ?? {})[0]?.access);
    expect(rolesOfFirstWrite(narrowed)).toEqual(["SystemAdmin"]);
    expect(rolesOfFirstWrite(defaulted)).toContain("TenantAdmin");
  });

  test("composeOpsStack({ access }) sets the delivery handler roles", () => {
    const delivery = (features: readonly FeatureDefinition[]): FeatureDefinition | undefined =>
      features.find((f) => f.name === "delivery");
    const narrowed = delivery(composeOpsStack({ delivery: true, access: ["SystemAdmin"] }));
    const first = Object.values(narrowed?.queryHandlers ?? {})[0];
    expect(rolesOf(first?.access)).toEqual(["SystemAdmin"]);
  });

  test("composeGdprStack retention-first (money-horse / publicstatus pattern)", () => {
    expect(stackFeatureNames(composeGdprStack({ tenantLifecycle: true, sessions: true }))).toEqual([
      "data-retention",
      "compliance-profiles",
      "tenant-lifecycle",
      "auth-foundation",
      "sessions",
    ]);
  });

  test("composeGdprStack compliance-first (studio pattern)", () => {
    expect(stackFeatureNames(composeGdprStack({ order: "compliance-first" }))).toEqual([
      "compliance-profiles",
      "data-retention",
    ]);
  });

  test("composeUserDataRightsStack → udr + defaults", () => {
    expect(stackFeatureNames(composeUserDataRightsStack())).toEqual([
      "user-data-rights",
      "user-data-rights-defaults",
    ]);
  });

  test("composeOpsStack defaults delivery + audit + jobs", () => {
    expect(stackFeatureNames(composeOpsStack())).toEqual(["delivery", "audit", "jobs"]);
  });

  test("composeOpsStack rateLimiting opt-in", () => {
    expect(stackFeatureNames(composeOpsStack({ rateLimiting: true }))).toEqual([
      "delivery",
      "audit",
      "jobs",
      "rate-limiting",
    ]);
  });

  test("composeIdentityStack defaults auth-foundation + sessions", () => {
    expect(stackFeatureNames(composeIdentityStack())).toEqual(["auth-foundation", "sessions"]);
  });

  test("composeIdentityStack mounts auth-mfa when mfa options given", () => {
    expect(stackFeatureNames(composeIdentityStack({ mfa: TEST_MFA }))).toEqual([
      "auth-foundation",
      "sessions",
      "auth-mfa",
    ]);
  });

  test("composeIdentityStack sessions:false + mfa → auth-mfa only", () => {
    expect(stackFeatureNames(composeIdentityStack({ sessions: false, mfa: TEST_MFA }))).toEqual([
      "auth-mfa",
    ]);
  });

  test("composeIdentityStack + composeGdprStack(sessions) → identical sessions deduped at boot", () => {
    const names = stackFeatureNames([
      ...composeIdentityStack(),
      ...composeGdprStack({ sessions: true }),
    ]);
    expect(names.filter((n) => n === "sessions")).toHaveLength(2);
    const composed = composeFeatures(
      [
        createPersonalAccessTokensFeature({ scopes: {} }),
        ...composeIdentityStack(),
        ...composeGdprStack({ sessions: true }),
      ],
      { includeBundled: true },
    );
    expect(stackFeatureNames(composed).filter((n) => n === "sessions")).toHaveLength(1);
    expect(() => validateBoot(composed)).not.toThrow();
  });
});

/** Snapshot, not a live parity check: intended block combinations, mirrored by hand from studio/money-horse/publicstatus run-configs. A drifted run-config stays green here. */
describe("composeStacks boots for real", () => {
  test("studio-shaped combined stack passes validateBoot (not just name-list comparison)", () => {
    const features = composeFeatures(
      [
        createPersonalAccessTokensFeature({ scopes: {} }),
        ...composeOpsStack({ rateLimiting: true }),
        ...composePagesStack(),
        // legal-pages requires template-resolver, which ships in the renderer stack.
        ...composeRendererStack(),
        ...composeMailStack({ transports: ["inmemory"] }),
        ...composeFileStack({ providers: ["inmemory"] }),
        ...composeGdprStack({ order: "compliance-first", sessions: true }),
        ...composeUserDataRightsStack(),
      ],
      { includeBundled: true },
    );
    expect(() => validateBoot(features)).not.toThrow();
  });

  test("money-horse-shaped composeGdprStack({sessions:true}) without a tokenVerifier provider passes boot", () => {
    // Session-only stacks: composeGdprStack({sessions:true}) mounts
    // auth-foundation + sessions (sessionStore). Cookie auth does not need a
    // tokenVerifier; money-horse/solon run-configs pass none and must boot.
    const features = composeFeatures([...composeGdprStack({ sessions: true })], {
      includeBundled: true,
    });
    expect(() => validateBoot(features)).not.toThrow();
  });

  test("composeGdprStack({sessions:true, providers:[...]}) passes boot with a tokenVerifier mounted", () => {
    const features = composeFeatures(
      [
        ...composeGdprStack({
          sessions: true,
          providers: [createPersonalAccessTokensFeature({ scopes: {} })],
        }),
      ],
      { includeBundled: true },
    );
    expect(() => validateBoot(features)).not.toThrow();
  });

  // auth-mfa's encrypted fields need a runtime KEK (env or configureEntityFieldEncryption
  // + secrets). Name-list + saas-identity-wire.integration.test.ts cover identity boot.
  test("identity stack names compose with ops + renderer under includeBundled", () => {
    const features = composeFeatures(
      [
        ...composeIdentityStack({ mfa: TEST_MFA }),
        ...composeOpsStack(),
        ...composeRendererStack(),
        ...composeMailStack({ transports: ["inmemory"] }),
      ],
      { includeBundled: true },
    );
    const names = stackFeatureNames(features);
    expect(names).toContain("auth-email-password");
    expect(names).toContain("sessions");
    expect(names).toContain("auth-mfa");
    expect(names).toContain("delivery");
  });
});

describe("composeStacks intended block names (snapshot, not live parity)", () => {
  test("studio SaaS blocks are covered by presets", () => {
    const names = stackFeatureNames([
      ...composeOpsStack({ rateLimiting: true }),
      ...composePagesStack(),
      // Pages content sits on template-resolver, which the renderer stack mounts.
      ...composeRendererStack(),
      ...composeMailStack({ transports: ["inmemory", "smtp"] }),
      ...composeFileStack({ providers: ["inmemory", "s3"] }),
      ...composeGdprStack({ order: "compliance-first" }),
      ...composeUserDataRightsStack(),
    ]);
    for (const expected of [
      "delivery",
      "audit",
      "jobs",
      "rate-limiting",
      "template-resolver",
      "legal-pages",
      "mail-foundation",
      "file-foundation",
      "files",
      "compliance-profiles",
      "data-retention",
      "user-data-rights",
      "user-data-rights-defaults",
    ]) {
      expect(names).toContain(expected);
    }
  });

  test("money-horse GDPR + file block names", () => {
    const names = stackFeatureNames([
      ...composePagesStack(),
      ...composeRendererStack(),
      ...composeOpsStack({ delivery: true, audit: false, jobs: false }),
      ...composeGdprStack({ sessions: true }),
      ...composeFileStack({ providers: ["s3-env"] }),
      ...composeUserDataRightsStack(),
    ]);
    for (const expected of [
      "template-resolver",
      "legal-pages",
      "data-retention",
      "compliance-profiles",
      "sessions",
      "file-foundation",
      "file-provider-s3-env",
      "files",
      "user-data-rights",
    ]) {
      expect(names).toContain(expected);
    }
  });

  test("publicstatus core stack block names", () => {
    const names = stackFeatureNames([
      ...composePagesStack(),
      ...composeGdprStack({ tenantLifecycle: true }),
      ...composeOpsStack({ delivery: true, audit: true, jobs: true }),
      ...composeRendererStack(),
      ...composeFileStack({ providers: ["inmemory"] }),
      ...composeUserDataRightsStack(),
    ]);
    for (const expected of [
      "template-resolver",
      "legal-pages",
      "tenant-lifecycle",
      "audit",
      "delivery",
      "jobs",
      "renderer-mail-html",
      "files",
    ]) {
      expect(names).toContain(expected);
    }
  });

  test("identity stack covers sessions + auth-mfa", () => {
    const names = stackFeatureNames(composeIdentityStack({ mfa: TEST_MFA }));
    expect(names).toContain("sessions");
    expect(names).toContain("auth-mfa");
  });
});

const TIERS: CreateTierEngineOptions<{ readonly seats: number }> = {
  defaultTier: "free",
  tierMap: {
    free: { features: [], caps: { seats: 1 } },
    pro: { features: [], caps: { seats: 10 } },
  },
};

// Minimal host the security combos need: sessions requires user +
// auth-foundation, audit requires tenant, tenant requires config.
function securityHostFeatures(): FeatureDefinition[] {
  return [
    createConfigFeature(),
    createUserFeature(),
    createTenantFeature(),
    createAuthFoundationFeature(),
  ];
}

function selfServiceFeatures(): FeatureDefinition[] {
  return [
    createDataRetentionFeature(),
    createComplianceProfilesFeature(),
    createSessionsFeature(),
    createUserDataRightsFeature({}),
    createUserProfileFeature(),
  ];
}

describe("auth, saas and security stacks", () => {
  test("composeAuthStack with mfa adds account-security after auth-mfa", () => {
    expect(stackFeatureNames(composeAuthStack({ mfa: TEST_MFA }))).toEqual([
      "auth-foundation",
      "sessions",
      "auth-mfa",
      "account-security",
    ]);
  });

  test("composeAuthStack without mfa mounts no account-security", () => {
    expect(stackFeatureNames(composeAuthStack())).toEqual(["auth-foundation", "sessions"]);
  });

  test("composeSaasStack stripe leaves subscription-stripe to the billing option", () => {
    expect(
      stackFeatureNames(
        composeSaasStack({
          billing: "stripe",
          tiers: TIERS,
          caps: {
            caps: [{ id: "seats", label: "Seats", limit: () => null, usage: async () => null }],
          },
          waitlist: {},
        }),
      ),
    ).toEqual(["billing-foundation", "tier-engine", "cap-counter", "cap-overview", "waitlist"]);
  });

  test("composeSaasStack mollie mounts subscription-mollie itself", () => {
    const names = stackFeatureNames(
      composeSaasStack({
        billing: "mollie",
        mollie: {
          apiKey: "test_mollie_key",
          webhookUrl: "https://app.example/api/subscription/webhook/mollie",
          priceToTier: {},
          priceToConfig: {},
        },
        tiers: TIERS,
      }),
    );
    expect(names).toEqual(["billing-foundation", "tier-engine", "subscription-mollie"]);
  });

  test("composeSecurityStack mounts the security baseline", () => {
    expect(stackFeatureNames(composeSecurityStack())).toEqual([
      "sessions",
      "crypto-shredding",
      "rate-limiting",
      "audit",
    ]);
    expect(stackFeatureNames(composeSecurityStack({ includeSessions: false }))).toEqual([
      "crypto-shredding",
      "rate-limiting",
      "audit",
    ]);
  });

  test("composeGdprStack selfService keeps the require-order of the self-service features", () => {
    expect(stackFeatureNames(composeGdprStack({ selfService: {} }))).toEqual([
      "data-retention",
      "compliance-profiles",
      "sessions",
      "user-data-rights",
      "user-profile",
    ]);
  });

  test("composeSecurityStack returns exactly the SECURITY_BASELINE_FEATURE_NAMES feature names", () => {
    expect(stackFeatureNames(composeSecurityStack())).toEqual([...SECURITY_BASELINE_FEATURE_NAMES]);
  });

  test("composeSecurityStack yields fresh feature instances on each call", () => {
    const a = composeSecurityStack();
    const b = composeSecurityStack();
    expect(a).toHaveLength(b.length);
    a.forEach((feature, i) => {
      expect(feature).not.toBe(b[i]);
    });

    const withoutSessionsA = composeSecurityStack({ includeSessions: false });
    const withoutSessionsB = composeSecurityStack({ includeSessions: false });
    expect(withoutSessionsA).toHaveLength(3);
    withoutSessionsA.forEach((feature, i) => {
      expect(feature).not.toBe(withoutSessionsB[i]);
    });
  });

  test("a standalone crypto-shredding and the stack's crypto-shredding collapse to one entry", () => {
    const security = composeFeatures(
      [...composeAuthStack(), createCryptoShreddingFeature(), ...composeSecurityStack()],
      { includeBundled: true },
    );
    expect(stackFeatureNames(security).filter((name) => name === "crypto-shredding")).toHaveLength(
      1,
    );
    expect(() => validateBoot(security)).not.toThrow();
  });

  test("includeSessions:false with the self-service features has no duplicates and covers the baseline", () => {
    const names = [
      ...selfServiceFeatures(),
      ...composeSecurityStack({ includeSessions: false }),
    ].map((f) => f.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of SECURITY_BASELINE_FEATURE_NAMES) {
      expect(names).toContain(name);
    }
  });

  test("self-service features + composeSecurityStack() boot with exactly one sessions", () => {
    // user-data-rights-defaults requires "files"; a bare stub is enough here.
    const filesStub = defineFeature("files", () => {});
    const registry = createRegistry([
      ...securityHostFeatures(),
      createAuthEmailPasswordFeature({}),
      filesStub,
      createUserDataRightsDefaultsFeature(),
      ...selfServiceFeatures(),
      ...composeSecurityStack(),
    ]);
    expect(registry.getFeature("sessions")).toBeDefined();
  });

  test("sessions mounted with different options than the stack's throws a clear boot error", () => {
    expect(() =>
      createRegistry([
        ...securityHostFeatures(),
        createSessionsFeature({ expiresInMs: 1000 }),
        ...composeSecurityStack(),
      ]),
    ).toThrow(/Duplicate feature: "sessions".*different options/);
  });

  test("auth + security + gdpr + ops + saas boot together without duplicates", () => {
    const features = composeFeatures(
      [
        ...composeAuthStack(),
        ...composeSecurityStack(),
        ...composeGdprStack({ selfService: {}, tenantLifecycle: true }),
        ...composeFileStack({ providers: ["inmemory"] }),
        createUserDataRightsDefaultsFeature(),
        ...composeOpsStack({ rateLimiting: true }),
        ...composeSaasStack({ billing: "stripe", tiers: TIERS }),
      ],
      { includeBundled: true },
    );
    const names = stackFeatureNames(features);
    expect(names.filter((name) => name === "sessions")).toHaveLength(1);
    expect(names.filter((name) => name === "audit")).toHaveLength(1);
    expect(() => validateBoot(features)).not.toThrow();
  });
});
