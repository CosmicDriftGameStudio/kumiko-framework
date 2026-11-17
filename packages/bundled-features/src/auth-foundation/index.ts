// Public API of the auth-foundation bundled-feature.

export { revokeAllUserCredentials } from "./credential-revoker.ts";
export { authEnvSchema } from "./env.ts";
export {
  createAuthFoundationFeature,
  type ResolvedTenantResolver,
  resolveSessionStore,
  resolveTenantExistence,
  resolveTenantResolver,
  resolveTokenVerifier,
} from "./feature.ts";
export { resolveAnonymousAccessFromRegistry } from "./resolve-anonymous-access.ts";
export {
  type AuthProviderBuildDeps,
  type AuthProviderPlugin,
  type AuthVerifier,
  type CredentialRevoker,
  EXT_CREDENTIAL_REVOKER,
  EXT_SESSION_STORE,
  EXT_TENANT_EXISTENCE,
  EXT_TENANT_RESOLVER,
  EXT_TOKEN_VERIFIER,
  isAuthProviderPlugin,
  isCredentialRevoker,
  isSessionStoreProvider,
  isTenantExistenceProvider,
  isTenantResolverProvider,
  isTenantResolverTrust,
  isValidTokenShape,
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
} from "./types.ts";
