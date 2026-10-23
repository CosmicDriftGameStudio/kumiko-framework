import type { Hono, MiddlewareHandler } from "hono";
import type { DbConnection } from "../db/connection.ts";
import { runInSystemRowLevelSecurityScope } from "../db/row-level-security-scope.ts";
import type { Registry } from "../engine/types/index.ts";
import type { ObservabilityProvider } from "../observability/index.ts";
import { resolveTenantLifecyclePlugin } from "../pipeline/active-membership.ts";
import { authEndpointRateLimit, globalIpRateLimit } from "../rate-limit/index.ts";
import { authMiddleware, getUser, type TenantLifecycleStatusResolver } from "./auth-middleware.ts";
import { assertSessionCallbacksPaired, type LoginRateLimiter } from "./auth-routes.ts";
import { csrfMiddleware } from "./csrf-middleware.ts";
import type { JwtHelper } from "./jwt.ts";
import { observabilityMiddleware } from "./observability-middleware.ts";
import {
  assertOriginGuardConfig,
  normalizeOrigin,
  resolveOriginGuard,
} from "./origin-middleware.ts";
import { patRouteGuard } from "./pat-route-guard.ts";
import { piiCiphertextResponseGuard } from "./pii-leak-guard.ts";
import { requestIdMiddleware } from "./request-id-middleware.ts";
import type { ServerOptions } from "./server.ts";
import type { PublicApiRequestMatcher } from "./server-extra-routes.ts";
import type { ServerWiring } from "./server-wiring.ts";
import {
  type ResolvedSessionCookies,
  resolveSessionCookies,
  sessionCookiesMiddleware,
} from "./session-cookies.ts";

export function installSessionCookies(
  app: Hono,
  auth: ServerOptions["auth"],
): ResolvedSessionCookies {
  // Resolved once; auth routes, auth/csrf middleware and the tenant-cookie
  // helpers read the cookie names from the request context.
  const sessionCookies = resolveSessionCookies({
    secureCookies: auth?.secureCookies,
    cookieDomain: auth?.cookieDomain,
    retiredCookieDomains: auth?.retiredCookieDomains,
  });
  app.use("*", sessionCookiesMiddleware(sessionCookies));
  return sessionCookies;
}

export function installRequestId(
  app: Hono,
  wiring: Pick<ServerWiring, "options" | "clientIpResolver">,
): void {
  const { options, clientIpResolver } = wiring;
  app.use(
    "/api/*",
    requestIdMiddleware({
      resolver: clientIpResolver,
      ...(options.errorDocs && { errorDocs: options.errorDocs }),
    }),
  );
}

export function installRateLimitMiddleware(
  app: Hono,
  wiring: Pick<
    ServerWiring,
    | "options"
    | "rateLimitResolver"
    | "rateLimitMiddlewareRequested"
    | "clientIpResolver"
    | "observability"
  >,
): MiddlewareHandler | undefined {
  const { options, rateLimitResolver, clientIpResolver, observability } = wiring;
  // L1/L2 rate-limit middleware run BEFORE auth so an unauthenticated
  // flood can't even reach the JWT-verify code path. Wired only when
  // the caller passed `rateLimit.global` or `rateLimit.auth`. The
  // resolver is the auto-wired one (or `context.rateLimit` if set);
  // boot-fails loudly when the caller asked for middleware without a
  // working Redis to back it.
  let globalRateLimitGuard: MiddlewareHandler | undefined;
  if (wiring.rateLimitMiddlewareRequested) {
    if (!rateLimitResolver) {
      throw new Error(
        "rateLimit middleware requested but no resolver available — pass `context.redis` " +
          "or `context.rateLimit` so the resolver can be built.",
      );
    }
    if (options.rateLimit?.global) {
      globalRateLimitGuard = globalIpRateLimit({
        ...options.rateLimit.global,
        resolver: rateLimitResolver,
        clientIpResolver,
        meter: observability.meter,
      });
      app.use("/api/*", globalRateLimitGuard);
    }
    if (options.rateLimit?.auth) {
      const { path: l2Path = "/api/auth/*", ...l2Opts } = options.rateLimit.auth;
      app.use(
        l2Path,
        authEndpointRateLimit({ ...l2Opts, resolver: rateLimitResolver, clientIpResolver }),
      );
    }
  }
  return globalRateLimitGuard;
}

export function installObservability(app: Hono, observability: ObservabilityProvider): void {
  // Observability span wraps everything that follows (auth, routes).
  // Must come AFTER request-id (so span can carry the id) and BEFORE auth
  // (so auth-verify can be a child span once we instrument it in v2).
  app.use(
    "/api/*",
    observabilityMiddleware({
      tracer: observability.tracer,
      meter: observability.meter,
    }),
  );
}

export function installPiiLeakGuard(app: Hono): void {
  // Tripwire: a kumiko-pii: ciphertext in a JSON response is always a bug
  // (raw read leaked past a decrypt) — dev fails loud, prod redacts.
  app.use("/api/*", piiCiphertextResponseGuard());
}

export type AuthGuardChain = {
  readonly tenantLifecycleResolver: TenantLifecycleStatusResolver | undefined;
  readonly sessionOnlyHttpRouteGuards: readonly MiddlewareHandler[];
};

export function installAuthGuardChain(
  app: Hono,
  wiring: Pick<ServerWiring, "options" | "jwt" | "baseDb">,
  scope: {
    readonly isPublicApiRequest: PublicApiRequestMatcher;
    readonly globalRateLimitGuard: MiddlewareHandler | undefined;
  },
): AuthGuardChain {
  const { options, jwt, baseDb } = wiring;
  const { isPublicApiRequest, globalRateLimitGuard } = scope;
  // Auth middleware skips public paths (login, health) — those routes need
  // to be callable without a valid JWT. Every other /api/* request requires
  // a token (or, when anonymousAccess is wired, falls through as anonymous).
  // A session-checker is forwarded when the auth-config wires one, so the
  // middleware can reject revoked sids on every request.
  // Mounting a tenantLifecycleStatus provider is what turns the 410 on, so no
  // entrypoint can forget the wiring; `??` short-circuits, so an explicit
  // auth.resolveTenantLifecycleStatus remains the override.
  const tenantLifecycleResolver =
    options.auth?.resolveTenantLifecycleStatus ??
    deriveTenantLifecycleResolver(options.registry, baseDb);
  // sessionOnlyGuard deliberately does NOT get this — its callers have no
  // anonymousAccess fallback, so a foreign-origin cookie there must keep
  // failing through the sibling originMiddleware 403.
  const normalizedForeignCookieOrigins = options.auth?.allowedOrigins?.length
    ? new Set(options.auth.allowedOrigins.map(normalizeOrigin))
    : undefined;
  const jwtGuard = buildJwtGuard(
    options,
    jwt,
    tenantLifecycleResolver,
    normalizedForeignCookieOrigins,
  );
  useOnProtectedApiPaths(app, isPublicApiRequest, jwtGuard);

  // Fail-closed PAT scoping: a PAT-authenticated caller (user.pat set by
  // jwtGuard's tokenVerifier above) may only reach the dispatcher routes —
  // everywhere else on /api/* is off-limits regardless of granted scopes.
  const patRouteGuardMiddleware = patRouteGuard();
  useOnProtectedApiPaths(app, isPublicApiRequest, patRouteGuardMiddleware);

  // Without anonymousAccess a missing token 401s instead of falling through as anonymous.
  const sessionOnlyGuard = buildSessionOnlyGuard(options, jwt, tenantLifecycleResolver);

  // PAT rate limiting — runs AFTER the auth guard so the resolved principal is
  // available. Only PAT-authenticated requests are counted (keyed by token id);
  // cookie/JWT users pass through untouched. In-memory limiter is per-instance
  // (see run-prod-app) — a multi-node deployment wanting a shared counter swaps
  // in a Redis-backed LoginRateLimiter.
  const patRateLimiter = options.auth?.patRateLimiter;
  const patRateLimitGuard = patRateLimiter ? buildPatRateLimitGuard(patRateLimiter) : undefined;
  if (patRateLimitGuard) {
    useOnProtectedApiPaths(app, isPublicApiRequest, patRateLimitGuard);
  }

  // Origin-allowlist guard — additional CSRF-hardening for deployments that
  // widen the auth cookie across subdomains (auth.cookieDomain). Registered
  // when allowedOrigins is non-empty, or with host-only cookies when
  // auth.publicOrigin is known (see resolveOriginGuard), with the same /api/* + public-skip
  // scope as the CSRF guard and BEFORE it, so a disallowed cross-site POST
  // surfaces as `origin_not_allowed` rather than `csrf_token_mismatch`. Fails
  // closed (assertOriginGuardConfig throws) when a wide cookieDomain is set
  // without an allowlist and without an explicit opt-out — that config is the
  // unguarded-subdomain-XSS footgun, not a warn-and-continue case.
  assertOriginGuardConfig(options.auth);
  assertSessionCallbacksPaired(options.auth);
  const originGuard = resolveOriginGuard(options.auth);
  if (originGuard) {
    useOnProtectedApiPaths(app, isPublicApiRequest, originGuard);
  }

  // Double-submit CSRF guard — runs only on cookie-authenticated,
  // state-changing requests (POST/PUT/PATCH/DELETE). The guard reads the
  // authTransport flag set by authMiddleware, so public paths (no auth)
  // and bearer-authenticated paths (no cookie vector) fall straight
  // through. Must be registered AFTER the auth middleware above so the
  // flag is populated; registered for the same scope so /api/* routes
  // are covered uniformly.
  const csrfGuard = csrfMiddleware();
  useOnProtectedApiPaths(app, isPublicApiRequest, csrfGuard);

  // No PAT rate-limit here: patRouteGuardMiddleware rejects every PAT on httpRoutes before it could count.
  // httpRoutes sit outside /api/*, so the pre-auth /api/* middlewares do not run for them: the
  // global IP limit (an unauthenticated flood must not reach JWT verify / session checks) and the
  // PII ciphertext tripwire are re-attached here. requestId, body limit and observability are not.
  const sessionOnlyHttpRouteGuards: readonly MiddlewareHandler[] = [
    ...(globalRateLimitGuard ? [globalRateLimitGuard] : []),
    piiCiphertextResponseGuard(),
    sessionOnlyGuard,
    patRouteGuardMiddleware,
    ...(originGuard ? [originGuard] : []),
    csrfGuard,
  ];
  return { tenantLifecycleResolver, sessionOnlyHttpRouteGuards };
}

function useOnProtectedApiPaths(
  app: Hono,
  isPublicApiRequest: PublicApiRequestMatcher,
  guard: MiddlewareHandler,
): void {
  app.use("/api/*", async (c, next) => {
    if (isPublicApiRequest(c)) return next();
    return guard(c, next);
  });
}

function collectTenantlessAnonymousWriteQns(registry: Registry): ReadonlySet<string> {
  return new Set<string>(
    [...registry.getAllWriteHandlers()]
      .filter(([, handler]) => handler.tenantlessAnonymous === true)
      .map(([qn]) => qn),
  );
}

function buildJwtGuard(
  options: Pick<ServerOptions, "registry" | "auth" | "anonymousAccess">,
  jwt: JwtHelper,
  tenantLifecycleResolver: TenantLifecycleStatusResolver | undefined,
  normalizedForeignCookieOrigins: ReadonlySet<string> | undefined,
): MiddlewareHandler {
  const tenantlessAnonymousQns = collectTenantlessAnonymousWriteQns(options.registry);
  return authMiddleware(jwt, {
    ...(tenantlessAnonymousQns.size > 0
      ? { isTenantlessAnonymousWrite: (qn: string) => tenantlessAnonymousQns.has(qn) }
      : {}),
    ...(options.auth?.sessionChecker ? { sessionChecker: options.auth.sessionChecker } : {}),
    ...(options.auth?.tokenVerifier ? { tokenVerifier: options.auth.tokenVerifier } : {}),
    ...(tenantLifecycleResolver ? { resolveTenantLifecycleStatus: tenantLifecycleResolver } : {}),
    ...(options.anonymousAccess ? { anonymousAccess: options.anonymousAccess } : {}),
    ...(normalizedForeignCookieOrigins
      ? { foreignCookieOrigins: normalizedForeignCookieOrigins }
      : {}),
  });
}

function buildSessionOnlyGuard(
  options: Pick<ServerOptions, "auth">,
  jwt: JwtHelper,
  tenantLifecycleResolver: TenantLifecycleStatusResolver | undefined,
): MiddlewareHandler {
  return authMiddleware(jwt, {
    ...(options.auth?.sessionChecker ? { sessionChecker: options.auth.sessionChecker } : {}),
    ...(options.auth?.tokenVerifier ? { tokenVerifier: options.auth.tokenVerifier } : {}),
    ...(tenantLifecycleResolver ? { resolveTenantLifecycleStatus: tenantLifecycleResolver } : {}),
  });
}

// Must run after the auth guard so getUser(c) carries the PAT.
function buildPatRateLimitGuard(patRateLimiter: LoginRateLimiter): MiddlewareHandler {
  return async (c, next) => {
    const pat = getUser(c)?.pat;
    if (pat && !(await patRateLimiter.check(pat.tokenId))) {
      return c.json(
        {
          error: {
            code: "pat_rate_limited",
            httpStatus: 429,
            message: "personal access token rate limit exceeded",
            i18nKey: "auth.errors.patRateLimited",
          },
        },
        429,
      );
    }
    return next();
  };
}

function deriveTenantLifecycleResolver(
  registry: Registry,
  db: DbConnection | undefined,
): TenantLifecycleStatusResolver | undefined {
  const plugin = resolveTenantLifecyclePlugin(registry, "buildServer");
  if (!plugin) return undefined;
  if (!db) {
    throw new Error(
      "[kumiko] a tenantLifecycleStatus provider is mounted (tenant-lifecycle) but context.db is " +
        "missing — the request-level teardown gate needs a DbConnection. Pass context.db, or wire " +
        "auth.resolveTenantLifecycleStatus explicitly.",
    );
  }
  // Runs before any tenant context exists and reads the tenant row itself, so it needs system scope.
  return (tenantId) =>
    runInSystemRowLevelSecurityScope(
      "tenant lifecycle status is resolved before a tenant scope exists",
      () => plugin.resolveStatus(tenantId, { db }),
    );
}
