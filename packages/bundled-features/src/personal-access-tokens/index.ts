import type { FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";
import { PAT_DEFAULT_RATE_LIMIT, type PatRateLimit } from "./constants.ts";

export type { PatRateLimit } from "./constants.ts";
export { PAT_DEFAULT_RATE_LIMIT, PAT_FEATURE, PatHandlers, PatQueries } from "./constants.ts";
export type { BindPatAutoRevokeOnPasswordChange, PersonalAccessTokensOptions } from "./feature.ts";
export {
  bindPatAutoRevokeOnPasswordChangeFromFeature,
  createPersonalAccessTokensFeature,
} from "./feature.ts";
export type { CreatePatOptions, PatMfaVerifyResult } from "./handlers/create.write.ts";
export { hashPatToken, mintPatToken } from "./hash.ts";
export {
  PAT_REVOKED_AGGREGATE_TYPE,
  PAT_REVOKED_EVENT_QN,
  PAT_REVOKED_EVENT_SHORT,
  type PatRevokedPayload,
  patRevokedSchema,
} from "./pat-revoked-event.ts";
export { createPatResolver } from "./resolver.ts";
export { revokeAllPatTokensForUser } from "./revoke-for-user.ts";
export { apiTokenEntity, apiTokenTable } from "./schema/api-token.ts";
export type { PatScopeConfig, PatScopeDef } from "./scopes.ts";
export { expandScopes } from "./scopes.ts";

// Reads the per-token rate-limit config off a mounted PAT feature's exports.
// Falls back to the default when absent. run-prod-app uses this to build the
// limiter from the same declaration the feature was given.
export function patRateLimitFromFeature(feature: FeatureDefinition): PatRateLimit {
  const exports = feature.exports;
  if (exports && typeof exports === "object" && "rateLimit" in exports) {
    const { rateLimit } = exports;
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
