import {
  EXT_SESSION_STORE,
  EXT_TOKEN_VERIFIER,
  resolveTokenVerifier,
} from "@cosmicdrift/kumiko-bundled-features/auth-foundation";
import {
  AUTH_MFA_FEATURE,
  bindMfaTokenSecretsFromFeature,
} from "@cosmicdrift/kumiko-bundled-features/auth-mfa";
import {
  PAT_FEATURE,
  patRateLimitFromFeature,
} from "@cosmicdrift/kumiko-bundled-features/personal-access-tokens";
import { UserQueries } from "@cosmicdrift/kumiko-bundled-features/user";
import {
  type AuthRoutesConfig,
  createRedisLoginRateLimiter,
  type LoginRateLimiter,
  type TokenVerifier,
} from "@cosmicdrift/kumiko-framework/api";
import type { FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";
import { assertMfaSwitchTenantGate, buildSharedAuthRoutes } from "./boot/shared-boot-steps.ts";
import { buildProdSessionAuth, wireProdPatAutoRevoke } from "./run-prod-app-boot-context.ts";
import type { ProdBootConfig, ProdComposedFeatures } from "./run-prod-app-config.ts";
import type { ProdConnections } from "./run-prod-app-connections.ts";
import { shouldWireProdSessions } from "./session-wiring.ts";

type PatAuthFragment = {
  readonly tokenVerifier: TokenVerifier;
  readonly patRateLimiter: LoginRateLimiter;
};

export type ProdAuthWiring = {
  readonly mfaFeature: FeatureDefinition | undefined;
  readonly sessionAuthFragment: Awaited<ReturnType<typeof buildProdSessionAuth>> | undefined;
  readonly patAuthFragment: PatAuthFragment | undefined;
};

// Sessions are wired directly because db has already been created; unlike
// runDevApp, no late binding is needed. Once a sessionChecker is wired, JWTs
// without sid are rejected, so production sessions cannot be bypassed.
// sessionMassRevoker (the fourth callback from createSessionCallbacks) is not
// part of AuthRoutesConfig; bindAutoRevokeFromFeature hands it to the sessions
// feature so password change and reset revoke all sessions. Secure by default: the sessionStore provider
// goes through resolveSessionStore.
export async function wireProdAuth(
  config: ProdBootConfig,
  composed: ProdComposedFeatures,
  connections: ProdConnections,
): Promise<ProdAuthWiring> {
  const { features, registry, effectiveAuth, sessionsFeature } = composed;
  const { db, redis } = connections;
  const mfaFeature = features.find((f) => f.name === AUTH_MFA_FEATURE);
  if (mfaFeature) {
    bindMfaTokenSecretsFromFeature(mfaFeature)?.(config.jwtSecret, config.envSource);
    assertMfaSwitchTenantGate(registry, "runProdApp");
  }
  // Hoisted above buildProdSessionAuth: that call also wires MFA-enable/
  // disable → PAT-revoke (bindRevokeAllPatTokensFromFeature), so it needs
  // patFeature too.
  const patFeature = features.find((f) => f.name === PAT_FEATURE);
  const sessionAuthFragment = shouldWireProdSessions(
    Boolean(effectiveAuth),
    registry.getExtensionUsages(EXT_SESSION_STORE).length > 0,
  )
    ? await buildProdSessionAuth(db, registry, sessionsFeature, mfaFeature, patFeature)
    : undefined;

  // Password-change → PAT-revoke: independent of sessions/MFA being mounted
  // (buildProdSessionAuth only runs when a sessionStore provider is
  // registered), so wired unconditionally here whenever PAT itself is.
  if (patFeature) {
    wireProdPatAutoRevoke(db, patFeature);
  }

  // Token-verifier opt-in: any provider feature (personal-access-tokens, a
  // future auth-provider-jwt, ...) self-registers via
  // r.useExtension(EXT_TOKEN_VERIFIER, ...) — wire one generic resolver
  // whenever at least one is mounted, resolved by shape at request-time.
  // PAT keeps its own per-token rate limiter (patRateLimiter), unrelated to
  // verification.
  const hasTokenVerifierProviders = registry.getExtensionUsages(EXT_TOKEN_VERIFIER).length > 0;
  let patAuthFragment: PatAuthFragment | undefined;
  if (effectiveAuth && patFeature && hasTokenVerifierProviders) {
    const rl = patRateLimitFromFeature(patFeature);
    patAuthFragment = {
      tokenVerifier: (rawToken) => resolveTokenVerifier({ db, registry }, rawToken),
      patRateLimiter: createRedisLoginRateLimiter(redis, rl.maxRequests, rl.windowMs, "pat"),
    };
  }
  return { mfaFeature, sessionAuthFragment, patAuthFragment };
}

function buildMfaRateLimits(
  redis: ProdConnections["redis"],
): Pick<
  AuthRoutesConfig,
  "mfaVerifyRateLimit" | "mfaPreauthEnableStartRateLimit" | "mfaPreauthConfirmRateLimit"
> {
  return {
    mfaVerifyRateLimit: createRedisLoginRateLimiter(redis, undefined, undefined, "mfa-verify"),
    mfaPreauthEnableStartRateLimit: createRedisLoginRateLimiter(
      redis,
      undefined,
      undefined,
      "mfa-preauth-start",
    ),
    mfaPreauthConfirmRateLimit: createRedisLoginRateLimiter(
      redis,
      undefined,
      undefined,
      "mfa-preauth-confirm",
    ),
  };
}

export function buildProdAuthRoutes(
  effectiveAuth: NonNullable<ProdComposedFeatures["effectiveAuth"]>,
  config: ProdBootConfig,
  composed: ProdComposedFeatures,
  connections: ProdConnections,
  authWiring: ProdAuthWiring,
): AuthRoutesConfig {
  const { redis } = connections;
  const { authPublicOrigin } = composed;
  const { trustedProxyHops } = config;
  return {
    ...buildSharedAuthRoutes(effectiveAuth, Boolean(authWiring.mfaFeature)),
    userQuery: UserQueries.findForAuth,
    // Redis-backed, not the in-memory default createAuthRoutes falls
    // back to — an in-process limiter only rate-limits within a single
    // replica, so a multi-instance prod deployment would silently give
    // each replica its own bucket. Redis is required infra
    // here already (REDIS_URL), so this is free.
    loginRateLimit: createRedisLoginRateLimiter(redis),
    ...(effectiveAuth.secureCookies !== undefined && {
      secureCookies: effectiveAuth.secureCookies,
    }),
    ...(authPublicOrigin !== undefined && { publicOrigin: authPublicOrigin }),
    ...(trustedProxyHops !== undefined && { trustedProxyHops }),
    ...authWiring.sessionAuthFragment,
    ...authWiring.patAuthFragment,
    ...(authWiring.mfaFeature && buildMfaRateLimits(redis)),
  };
}
