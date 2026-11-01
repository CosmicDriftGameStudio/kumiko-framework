import type { FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";
import { PAT_DEFAULT_RATE_LIMIT, type PatRateLimit } from "./web/constants.ts";
import type { PatScopeConfig, PatScopeDef } from "./web/scopes.ts";

export type { BindPatAutoRevokeOnPasswordChange, PersonalAccessTokensOptions } from "./feature.ts";
export {
  bindPatAutoRevokeOnPasswordChangeFromFeature,
  createPersonalAccessTokensFeature,
} from "./feature.ts";
export type { CreatePatOptions, PatMfaVerifyResult } from "./handlers/create.write.ts";
export { hashPatToken, mintPatToken } from "./hash.ts";
export { patScopeOptionKey } from "./i18n.ts";
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
export type { PatRateLimit } from "./web/constants.ts";
export {
  PAT_DEFAULT_EXPIRES_IN_DAYS,
  PAT_DEFAULT_RATE_LIMIT,
  PAT_FEATURE,
  PAT_MAX_EXPIRES_IN_DAYS,
  PAT_SCREEN_ID,
  PatHandlers,
  PatQueries,
} from "./web/constants.ts";
export type { PatScopeConfig, PatScopeDef } from "./web/scopes.ts";
export { expandScopes } from "./web/scopes.ts";

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isPatScopeDef(value: unknown): value is PatScopeDef {
  if (!value || typeof value !== "object") return false;
  if (!("label" in value) || typeof value.label !== "string") return false;
  if (!("read" in value) || !isStringArray(value.read)) return false;
  return !("write" in value) || value.write === undefined || isStringArray(value.write);
}

function isPatScopeConfig(value: unknown): value is PatScopeConfig {
  return !!value && typeof value === "object" && Object.values(value).every(isPatScopeDef);
}

// Reads the scope catalog off a mounted PAT feature's exports; undefined for any other feature.
export function patScopesFromFeature(feature: FeatureDefinition): PatScopeConfig | undefined {
  const exports = feature.exports;
  if (exports && typeof exports === "object" && "scopes" in exports) {
    const { scopes } = exports;
    if (isPatScopeConfig(scopes)) return scopes;
  }
  return undefined;
}

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
