// Public API of the auth-foundation bundled-feature.

export { authFoundationFeature, resolveTokenVerifier } from "./feature";
export {
  type AuthProviderBuildDeps,
  type AuthProviderPlugin,
  type AuthVerifier,
  EXT_TOKEN_VERIFIER,
  isAuthProviderPlugin,
  isValidTokenShape,
  type TokenShape,
  tokenShapeKey,
  tokenShapeMatches,
} from "./types";
