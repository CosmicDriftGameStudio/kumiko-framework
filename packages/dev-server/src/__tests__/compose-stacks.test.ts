import { describe, expect, test } from "bun:test";
import { createPersonalAccessTokensFeature } from "@cosmicdrift/kumiko-bundled-features/personal-access-tokens";
import {
  dsgvoSelfServiceFeatures,
  securityBaselineFeatures,
} from "@cosmicdrift/kumiko-bundled-features/presets";
import type { CreateTierEngineOptions } from "@cosmicdrift/kumiko-bundled-features/tier-engine";
import { createUserDataRightsDefaultsFeature } from "@cosmicdrift/kumiko-bundled-features/user-data-rights-defaults";
import { validateBoot } from "@cosmicdrift/kumiko-framework/engine";
import { composeFeatures } from "@cosmicdrift/kumiko-server-runtime/compose-features";
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
} from "../compose-stacks.js";

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
    // Session-only stacks (#1570): composeGdprStack({sessions:true}) mounts
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

  test("composeGdprStack selfService keeps the dsgvoSelfServiceFeatures order", () => {
    expect(stackFeatureNames(composeGdprStack({ selfService: {} }))).toEqual(
      stackFeatureNames(dsgvoSelfServiceFeatures()),
    );
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

  test("composeSecurityStack and securityBaselineFeatures dedupe mid-migration", () => {
    const security = composeFeatures(
      [...composeAuthStack(), ...securityBaselineFeatures(), ...composeSecurityStack()],
      { includeBundled: true },
    );
    expect(stackFeatureNames(security).filter((name) => name === "crypto-shredding")).toHaveLength(
      1,
    );
    expect(() => validateBoot(security)).not.toThrow();
  });
});
