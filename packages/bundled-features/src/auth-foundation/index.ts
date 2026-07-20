// Public API of the auth-foundation bundled-feature.

export {
  authFoundationFeature,
  resolveSessionStore,
  resolveTokenVerifier,
} from "./feature";
export {
  type AuthProviderBuildDeps,
  type AuthProviderPlugin,
  type AuthVerifier,
  EXT_SESSION_STORE,
  EXT_TOKEN_VERIFIER,
  isAuthProviderPlugin,
  isSessionStoreProvider,
  isValidTokenShape,
  type SessionMassRevoker,
  type SessionStore,
  type SessionStoreProvider,
  type TokenShape,
  tokenShapeKey,
  tokenShapeMatches,
} from "./types";
