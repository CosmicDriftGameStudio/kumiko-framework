import type { FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";
import { PAT_DEFAULT_RATE_LIMIT, type PatRateLimit } from "./constants.js";

export type { PatRateLimit } from "./constants.js";
export { PAT_DEFAULT_RATE_LIMIT, PAT_FEATURE, PatHandlers, PatQueries } from "./constants.js";
export type { BindPatAutoRevokeOnPasswordChange, PersonalAccessTokensOptions } from "./feature.js";
export {
  bindPatAutoRevokeOnPasswordChangeFromFeature,
  createPersonalAccessTokensFeature,
} from "./feature.js";
export type { CreatePatOptions, PatMfaVerifyResult } from "./handlers/create.write.js";
export { hashPatToken, mintPatToken } from "./hash.js";
export {
  PAT_REVOKED_AGGREGATE_TYPE,
  PAT_REVOKED_EVENT_QN,
  PAT_REVOKED_EVENT_SHORT,
  type PatRevokedPayload,
  patRevokedSchema,
} from "./pat-revoked-event.js";
export { createPatResolver } from "./resolver.js";
export { revokeAllPatTokensForUser } from "./revoke-for-user.js";
export { apiTokenEntity, apiTokenTable } from "./schema/api-token.js";
export type { PatScopeConfig, PatScopeDef } from "./scopes.js";
export { expandScopes } from "./scopes.js";

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
