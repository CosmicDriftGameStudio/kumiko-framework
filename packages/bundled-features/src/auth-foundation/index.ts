// Public API of the auth-foundation bundled-feature.

export {
  authFoundationFeature,
  resolveSessionStore,
  resolveTenantExistence,
  resolveTenantResolver,
  resolveTokenVerifier,
  type ResolvedTenantResolver,
} from "./feature";
export { resolveAnonymousAccessFromRegistry } from "./resolve-anonymous-access";
export {
  type AuthProviderBuildDeps,
  type AuthProviderPlugin,
  type AuthVerifier,
  EXT_SESSION_STORE,
  EXT_TENANT_EXISTENCE,
  EXT_TENANT_RESOLVER,
  EXT_TOKEN_VERIFIER,
  isAuthProviderPlugin,
  isSessionStoreProvider,
  isTenantExistenceProvider,
  isTenantResolverProvider,
  isTenantResolverTrust,
  isValidTokenShape,
  type SessionMassRevoker,
  type SessionStore,
  type SessionStoreProvider,
  type TenantExistenceProvider,
  type TenantExistsFn,
  type TenantResolverFn,
  type TenantResolverProvider,
  type TenantResolverTrust,
  type TokenShape,
  tokenShapeKey,
  tokenShapeMatches,
} from "./types";
