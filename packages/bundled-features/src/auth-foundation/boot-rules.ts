import type { BootRuleTable } from "@cosmicdrift/kumiko-framework/engine";

export const AUTH_FOUNDATION_BOOT_RULES = {
  tokenVerifierInvalidPlugin: {
    id: "auth-foundation/token-verifier-invalid-plugin",
    summary:
      "A tokenVerifier provider registers a valid AuthProviderPlugin with a { shape, build } options shape.",
    fix: "Register the provider with options of shape { shape, build }.",
  },
  noTokenVerifierOrSessionStore: {
    id: "auth-foundation/no-token-verifier-or-session-store",
    summary:
      "At least one tokenVerifier provider or a sessionStore is registered alongside auth-foundation.",
    fix: "Mount an auth-provider-* feature (e.g. auth-provider-jwt / personal-access-tokens) or a sessionStore (e.g. sessions).",
  },
  tokenVerifierShapeCollision: {
    id: "auth-foundation/token-verifier-shape-collision",
    summary:
      "No two tokenVerifier providers claim the same token shape, so resolveTokenVerifier can route unambiguously.",
    fix: "Give each provider a distinct shape.",
  },
  singleProviderInvalidShape: {
    id: "auth-foundation/single-provider-invalid-shape",
    summary:
      "A single-provider extension registration carries the options shape its provider type requires.",
    fix: "Register the provider with the options shape named in the error message.",
  },
  singleProviderMultiple: {
    id: "auth-foundation/single-provider-multiple",
    summary: "At most one provider of a single-provider extension is mounted at a time.",
    fix: "Unmount all but one provider.",
  },
} as const satisfies BootRuleTable;
