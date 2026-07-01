import type { FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";
import { PAT_DEFAULT_RATE_LIMIT, type PatRateLimit } from "./constants";
import type { PatScopeConfig } from "./scopes";

export type { PatRateLimit } from "./constants";
export { PAT_DEFAULT_RATE_LIMIT, PAT_FEATURE, PatHandlers, PatQueries } from "./constants";
export type { PersonalAccessTokensOptions } from "./feature";
export { createPersonalAccessTokensFeature } from "./feature";
export { hashPatToken, mintPatToken } from "./hash";
export { createPatResolver } from "./resolver";
export { apiTokenEntity, apiTokenTable } from "./schema/api-token";
export type { PatScopeConfig, PatScopeDef } from "./scopes";
export { expandScopes } from "./scopes";

// Reads the scope catalog off a mounted PAT feature's exports (set from the
// setup-callback return). run-prod-app uses this to build the resolver from the
// same config the handlers were given. Returns {} for a non-PAT / malformed
// definition — the caller has already matched on feature.name.
export function patScopesFromFeature(feature: FeatureDefinition): PatScopeConfig {
  const exports = feature.exports;
  if (exports && typeof exports === "object" && "scopes" in exports) {
    const { scopes } = exports as { scopes: unknown };
    if (scopes && typeof scopes === "object") return scopes as PatScopeConfig;
  }
  return {};
}

// Reads the per-token rate-limit config off a mounted PAT feature's exports.
// Falls back to the default when absent. run-prod-app uses this to build the
// limiter from the same declaration the feature was given.
export function patRateLimitFromFeature(feature: FeatureDefinition): PatRateLimit {
  const exports = feature.exports;
  if (exports && typeof exports === "object" && "rateLimit" in exports) {
    const { rateLimit } = exports as { rateLimit: unknown };
    if (
      rateLimit &&
      typeof rateLimit === "object" &&
      "maxRequests" in rateLimit &&
      "windowMs" in rateLimit
    ) {
      return rateLimit as PatRateLimit;
    }
  }
  return PAT_DEFAULT_RATE_LIMIT;
}
