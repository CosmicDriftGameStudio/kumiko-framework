import type { FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";
import type { PatScopeConfig } from "./scopes";

export { PAT_FEATURE } from "./constants";
export { hashPatToken, mintPatToken } from "./hash";
export { createPersonalAccessTokensFeature } from "./feature";
export type { PersonalAccessTokensOptions } from "./feature";
export { createPatResolver } from "./resolver";
export { apiTokenEntity, apiTokenTable } from "./schema/api-token";
export { expandScopes } from "./scopes";
export type { PatScopeConfig, PatScopeDef } from "./scopes";

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
