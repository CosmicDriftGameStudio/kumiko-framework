import type { Context, Next } from "hono";
import { getCookie } from "hono/cookie";
import { createAnonymousUser } from "../engine/system-user";
import type { SessionUser, TenantId } from "../engine/types";
import { parseTenantId } from "../engine/types/identifiers";
import { TENANT_COOKIE_NAME, TENANT_HEADER_NAME } from "./api-constants";
import type { JwtHelper } from "./jwt";

const USER_KEY = "pipelineUser";
const AUTH_TRANSPORT_KEY = "authTransport";

// Names used across middleware and auth-routes. Kept here so csrf-middleware
// and auth-routes import them from a single source of truth — renaming a
// cookie is a coordinated change across issuer, reader and deleter.
export const AUTH_COOKIE_NAME = "kumiko_auth";
export const CSRF_COOKIE_NAME = "kumiko_csrf";
export const CSRF_HEADER_NAME = "X-CSRF-Token";

// Prefix that marks a bearer token as a long-lived Personal Access Token
// rather than a JWT session. The PAT feature mints tokens with this prefix;
// the middleware uses it to route to patResolver instead of jwt.verify. Kept
// here so both sides import the same literal.
export const PAT_TOKEN_PREFIX = "kpat_";

// Which wire the current request authenticated over. Downstream
// csrf-middleware reads this: cookie-auth gets a CSRF-token check, bearer
// does not (headers aren't set cross-origin by browsers, so there is no
// CSRF vector on a bearer-only client).
export type AuthTransport = "cookie" | "bearer";

// Status of a sid from the server's perspective. The sessions feature owns
// the DB-backed implementation; middleware just consults whatever function
// the app wires in. "blocked" = sid is live but the user it belongs to is
// locked (restricted/deleted) — defense-in-depth so a missed session-revoke
// can't keep a locked account authenticated.
export type AuthSessionStatus = "live" | "revoked" | "expired" | "missing" | "blocked";

// Called by the middleware after JWT-verify. Gets the sid AND the expected
// userId from the JWT's `sub` — the checker MUST confirm the session row
// both exists + is live AND belongs to expectedUserId. Without the userId
// cross-check, a compromised-sid-but-valid-JWT combination from two
// different users could slip through (defense-in-depth: the JWT signing
// secret is the main control, but we don't want a single leaked sid to
// matter when the attacker already knows the userId too).
export type AuthSessionChecker = (
  sid: string,
  expectedUserId: string,
) => Promise<AuthSessionStatus>;

// Resolves a raw Personal Access Token (bearer, prefixed PAT_TOKEN_PREFIX)
// into a SessionUser, or null when the token is unknown/revoked/expired. The
// PAT feature owns the DB-backed implementation: hash the token, look up the
// row, resolve the user's CURRENT roles live (not a snapshot), and expand the
// token's granted scopes into `pat.allowedQns`. Middleware just consults it
// and short-circuits the JWT path on a hit.
export type PatResolver = (rawToken: string) => Promise<SessionUser | null>;

export type TenantLifecycleStatusResolver = (
  tenantId: TenantId,
) => Promise<{ readonly status: string } | null>;

export type AuthMiddlewareOptions = {
  // Called after JWT-verify when the token carries a sid. If the checker
  // reports anything other than "live", the request is rejected with 401.
  // Omit to run in stateless-JWT mode (any valid JWT is accepted).
  readonly sessionChecker?: AuthSessionChecker;
  // Called for bearer tokens carrying the PAT prefix, BEFORE jwt.verify. On a
  // hit the middleware sets the returned SessionUser and skips the JWT path
  // entirely. Omit to disable PAT auth (bearer PATs then fail jwt.verify → 401).
  readonly patResolver?: PatResolver;
  // Opt-in: when set, requests without a JWT are treated as anonymous
  // callers instead of being rejected with 401. The middleware synthesises
  // a SessionUser with id="anonymous" and roles=["anonymous"], scoped to a
  // tenantId resolved through the chain documented on AnonymousAccessConfig.
  readonly anonymousAccess?: AnonymousAccessConfig;
  // Consulted after tenantId is resolved (JWT/PAT/anonymous). Returns 410
  // when the tenant is in teardown (destroyRequested/destroying/destroyed).
  // cancel-destruction is exempt while status=destroyRequested.
  readonly resolveTenantLifecycleStatus?: TenantLifecycleStatusResolver;
};

// Resolves the tenant for an unauthenticated request. Returns null when no
// tenant can be determined — the middleware rejects with 400 instead of
// silently falling through. Throw only on infrastructure failures (DB down,
// cache broken) — those surface as 500. "Subdomain unknown" is null, not
// throw.
export type TenantResolver = (c: Context) => Promise<TenantId | null> | TenantId | null;

// Returns true when the tenantId names an active tenant. The middleware
// calls this after a header/cookie/resolver supplied a candidate, before
// the anonymous SessionUser is synthesised. Omit to skip the existence
// check entirely — fine for prototypes, NOT for production multi-tenant
// deployments where a caller could otherwise probe arbitrary ids.
export type TenantExists = (tenantId: TenantId) => Promise<boolean> | boolean;

// Single-tenant shortcut. When set, the server runs in **locked** mode:
//   - no client-supplied tenant: defaultTenantId is used.
//   - client supplies a matching tenant (header/cookie/resolver): allowed.
//   - client supplies a non-matching tenant: 400 tenant_mismatch (the
//     server is single-tenant; rejecting protects against confused clients
//     who think they're talking to a different deployment).
// The framework does NOT verify defaultTenantId against the DB at boot;
// the caller is responsible (see sample for the pattern).
// Per-request existence check for header/cookie/resolver-supplied ids.
// Skipped for the defaultTenantId path (the caller already vetted that
// value when configuring the server).
type AnonymousAccessConfigCommon = {
  readonly defaultTenantId?: TenantId;
  readonly tenantExists?: TenantExists;
};

// Union, not one flat optional-everything type: a tenantResolver without a
// declared resolverTrust is an ambiguous trust decision the compiler should
// catch, not a silent runtime default. Set resolverTrust to:
//   - "authoritative": the resolver is trusted (e.g. it derives the tenant
//     from the subdomain, which the client cannot forge) and is consulted
//     FIRST. A client-supplied tenant that disagrees with the resolver's
//     answer is rejected with 400 tenant_mismatch — it is never used to
//     override the resolver, and it is never used as a substitute answer
//     when the resolver returns null either (that would just reopen the
//     same override via an unrecognised host). Pick this whenever the
//     resolver derives the tenant from something the caller cannot control
//     (subdomain, mTLS cert, etc.) — the whole point of such a resolver is
//     defeated if a client header can still override it.
//   - "fallback-only": a client-supplied header/cookie wins outright; the
//     resolver only runs when neither is present. Pick this only when the
//     resolver is a pure convenience fallback for callers that never send
//     a tenant of their own (e.g. a bare API host with no per-tenant
//     subdomains) and its answer carries no more trust than the client's
//     own claim.
export type AnonymousAccessConfig =
  | (AnonymousAccessConfigCommon & {
      readonly tenantResolver?: undefined;
      readonly resolverTrust?: undefined;
    })
  | (AnonymousAccessConfigCommon & {
      readonly tenantResolver: TenantResolver;
      readonly resolverTrust: "authoritative" | "fallback-only";
    });

// Where the candidate tenant came from. Drives the validation policy:
//   - header / cookie / resolver: untrusted, must pass tenantExists if set.
//   - default: trusted (configured at boot), no per-request check.
type TenantSource = "header" | "cookie" | "resolver" | "default";

// Error-body shape matches the UnprocessableError/AccessDeniedError on the
// dispatcher path — clients parse `{error: {code, httpStatus, message,
// i18nKey, details?}}` everywhere, not a second middleware-only shape.
// All middleware rejects (missing/invalid/ambiguous token, session state,
// csrf mismatch) route through this helper so one parser covers the lot.
type MiddlewareRejectCode =
  | "missing_token"
  | "invalid_token"
  | "ambiguous_auth"
  | "session_invalid"
  | "tenant_required"
  | "tenant_not_found"
  | "tenant_mismatch"
  | "invalid_tenant_format"
  | "tenant_unavailable";

// @wrapper-known error-helper
function middlewareReject(
  c: Context,
  opts: {
    code: MiddlewareRejectCode;
    status: 400 | 401 | 403 | 404 | 410;
    message: string;
    i18nKey: string;
    details?: Record<string, unknown>;
  },
): Response {
  return c.json(
    {
      error: {
        code: opts.code,
        httpStatus: opts.status,
        message: opts.message,
        i18nKey: opts.i18nKey,
        ...(opts.details ? { details: opts.details } : {}),
      },
    },
    opts.status,
  );
}

// @wrapper-known error-helper
function sessionInvalid(c: Context, reason: AuthSessionStatus | "no_sid"): Response {
  return middlewareReject(c, {
    code: "session_invalid",
    status: 401,
    message: `session ${reason}`,
    i18nKey: "auth.errors.sessionInvalid",
    details: { reason },
  });
}

// Extract the JWT from either the kumiko_auth cookie (web) or the
// Authorization Bearer header (native / server-to-server). The two paths
// are mutually exclusive: if both are present the request is rejected with
// `ambiguous_auth` to prevent a confused-deputy bug where a server-bug
// could authenticate via one transport while the other sat there ignored.
// Note: this is NOT a CSRF control — Bearer-only clients are already safe
// because browsers can't set Authorization headers cross-origin. The reject
// exists so future middleware authors can't accidentally mix transports.
function extractToken(
  c: Context,
): { token: string; transport: AuthTransport } | { error: "both" | "missing" } {
  const cookieToken = getCookie(c, AUTH_COOKIE_NAME);
  const header = c.req.header("Authorization");
  const bearerToken = header?.startsWith("Bearer ") ? header.slice(7) : undefined;

  if (cookieToken && bearerToken) return { error: "both" };
  if (cookieToken) return { token: cookieToken, transport: "cookie" };
  if (bearerToken) return { token: bearerToken, transport: "bearer" };
  return { error: "missing" };
}

export function authMiddleware(jwt: JwtHelper, options: AuthMiddlewareOptions = {}) {
  const { sessionChecker, anonymousAccess, patResolver, resolveTenantLifecycleStatus } = options;

  // Fail loud at boot, not silently at request time: a tenantResolver
  // without a declared resolverTrust is an ambiguous trust decision no
  // sane default can make on the app's behalf (see AnonymousAccessConfig).
  if (anonymousAccess?.tenantResolver && anonymousAccess.resolverTrust === undefined) {
    throw new Error(
      "authMiddleware: anonymousAccess.tenantResolver is set without resolverTrust — " +
        'declare "authoritative" (resolver wins over client header/cookie) or ' +
        '"fallback-only" (client wins, resolver is a last resort).',
    );
  }

  return async (c: Context, next: Next) => {
    const extracted = extractToken(c);
    if ("error" in extracted) {
      if (extracted.error === "both") {
        return middlewareReject(c, {
          code: "ambiguous_auth",
          status: 400,
          message: "cookie and bearer transport presented simultaneously",
          i18nKey: "auth.errors.ambiguousAuth",
        });
      }
      // No JWT → either fall through as anonymous (when the server opts in)
      // or reject with 401 (preserving the pre-anonymous default).
      //
      // Auth-routes-Sonderfall: `/api/auth/*`-Pfade die NICHT in
      // PUBLIC_API_PATHS sind (tenants, switch-tenant, logout) brauchen
      // einen JWT — aber keinen Tenant-Resolve. Würden sie durch
      // handleAnonymous laufen, wirft resolveTenant 400 tenant_required
      // wenn kein Tenant declared ist. Falsche Diagnose: das Problem ist
      // missing authentication, nicht missing tenant. Daher hier direkt
      // 401, ohne den anonymous-Tenant-Flow zu durchlaufen.
      if (anonymousAccess) {
        if (c.req.path.startsWith("/api/auth/")) {
          return middlewareReject(c, {
            code: "missing_token",
            status: 401,
            message: "no auth cookie or bearer token",
            i18nKey: "auth.errors.missingToken",
          });
        }
        return await handleAnonymous(c, anonymousAccess, next, resolveTenantLifecycleStatus);
      }
      return middlewareReject(c, {
        code: "missing_token",
        status: 401,
        message: "no auth cookie or bearer token",
        i18nKey: "auth.errors.missingToken",
      });
    }
    const { token, transport } = extracted;

    // PAT path: a bearer token carrying the PAT prefix is a long-lived
    // Personal Access Token, not a JWT. Short-circuit the JWT path entirely.
    // Cookie transport is never a PAT (the browser holds the JWT).
    if (patResolver && transport === "bearer" && token.startsWith(PAT_TOKEN_PREFIX)) {
      return await handlePat(c, patResolver, token, next, resolveTenantLifecycleStatus);
    }

    let payload: Awaited<ReturnType<JwtHelper["verify"]>>;
    try {
      payload = await jwt.verify(token);
    } catch {
      return middlewareReject(c, {
        code: "invalid_token",
        status: 401,
        message: "token verification failed",
        i18nKey: "auth.errors.invalidToken",
      });
    }

    // Session liveness check — only when both a checker is wired AND the
    // token carries a sid.
    // A checker wired without a sid on the token means the token predates
    // session tracking (or the JWT was forged) — reject.
    if (sessionChecker) {
      if (payload.jti) {
        const status = await sessionChecker(payload.jti, payload.sub);
        if (status !== "live") {
          return sessionInvalid(c, status);
        }
      } else {
        return sessionInvalid(c, "no_sid");
      }
    }

    // Tenant-mismatch guard: if the caller sends BOTH a JWT (carrying a
    // signed tenantId) AND an X-Tenant header pointing at a different tenant,
    // reject loudly. JWT always wins on the wire, so silent ignore would let
    // a confused client believe it's hitting tenantB while it's actually on
    // tenantA. Same defensive stance as ambiguous_auth (cookie + bearer).
    const headerTenant = c.req.header(TENANT_HEADER_NAME);
    if (headerTenant !== undefined && headerTenant !== payload.tenantId) {
      return middlewareReject(c, {
        code: "tenant_mismatch",
        status: 400,
        message: "JWT tenantId and X-Tenant header disagree",
        i18nKey: "auth.errors.tenantMismatch",
        details: { jwtTenantId: payload.tenantId, headerTenantId: headerTenant },
      });
    }

    const user: SessionUser = {
      id: payload.sub,
      tenantId: payload.tenantId,
      roles: payload.roles,
      ...(payload.claims ? { claims: payload.claims } : {}),
      ...(payload.jti ? { sid: payload.jti } : {}),
    };
    const lifecycleReject = await rejectIfTenantTeardown(
      c,
      payload.tenantId,
      resolveTenantLifecycleStatus,
    );
    if (lifecycleReject) return lifecycleReject;
    c.set(USER_KEY, user);
    c.set(AUTH_TRANSPORT_KEY, transport);
    await next();
  };
}

export function getUser(c: Context): SessionUser {
  // @cast-boundary engine-bridge — Hono context.get returns unknown
  return c.get(USER_KEY) as SessionUser;
}

export function getAuthTransport(c: Context): AuthTransport | undefined {
  // @cast-boundary engine-bridge — Hono context.get returns unknown
  return c.get(AUTH_TRANSPORT_KEY) as AuthTransport | undefined;
}

// PAT request flow. Resolve the hashed token → SessionUser (live roles +
// granted scopes), then apply the same X-Tenant-mismatch guard as the JWT
// path before continuing. A null resolve is an invalid/revoked/expired token
// → 401. Structured like handleAnonymous so authMiddleware stays flat.
async function handlePat(
  c: Context,
  patResolver: PatResolver,
  token: string,
  next: Next,
  resolveTenantLifecycleStatus?: TenantLifecycleStatusResolver,
): Promise<Response | undefined> {
  const patUser = await patResolver(token);
  if (!patUser) {
    return middlewareReject(c, {
      code: "invalid_token",
      status: 401,
      message: "personal access token invalid, revoked or expired",
      i18nKey: "auth.errors.invalidToken",
    });
  }
  // The PAT carries its own tenant; an X-Tenant header pointing elsewhere is a
  // confused client — reject loudly, same stance as the JWT path.
  const headerTenant = c.req.header(TENANT_HEADER_NAME);
  if (headerTenant !== undefined && headerTenant !== patUser.tenantId) {
    return middlewareReject(c, {
      code: "tenant_mismatch",
      status: 400,
      message: "PAT tenantId and X-Tenant header disagree",
      i18nKey: "auth.errors.tenantMismatch",
      details: { patTenantId: patUser.tenantId, headerTenantId: headerTenant },
    });
  }
  c.set(USER_KEY, patUser);
  c.set(AUTH_TRANSPORT_KEY, "bearer");
  const lifecycleReject = await rejectIfTenantTeardown(
    c,
    patUser.tenantId,
    resolveTenantLifecycleStatus,
  );
  if (lifecycleReject) return lifecycleReject;
  await next();
  // skip: PAT path completed — next() ran; explicit return keeps the
  // Response|undefined union honest (same as handleAnonymous).
  return;
}

// Anonymous request flow. Steps:
//   1. Read raw client-supplied tenant from X-Tenant header / cookie.
//   2. Validate format (UUID-shape) — junk strings get 400 right here.
//   3. Pick the authoritative tenant:
//        - defaultTenantId set: locked single-tenant mode. A client tenant
//          that disagrees with default → 400 tenant_mismatch. Otherwise
//          default wins.
//        - else: client tenant > resolver(req). No tenant at all → 400.
//   4. For non-default sources, run tenantExists if configured → 404.
//   5. Synthesise the anonymous SessionUser. The transport flag stays unset
//      so csrf-middleware skips the double-submit check (no auth-cookie ⇒
//      no CSRF vector to defend against).
async function handleAnonymous(
  c: Context,
  config: AnonymousAccessConfig,
  next: Next,
  resolveTenantLifecycleStatus?: TenantLifecycleStatusResolver,
): Promise<Response | undefined> {
  // Step 1+2: parse client-supplied tenant. Reject malformed values before
  // they touch any downstream consumer (DB, cache, audit row).
  const headerRaw = c.req.header(TENANT_HEADER_NAME);
  const cookieRaw = getCookie(c, TENANT_COOKIE_NAME);

  const headerCheck = parseClientTenant(headerRaw, "X-Tenant header");
  if (headerCheck.error) return middlewareReject(c, headerCheck.error);
  const cookieCheck = parseClientTenant(cookieRaw, "kumiko_tenant cookie");
  if (cookieCheck.error) return middlewareReject(c, cookieCheck.error);

  const clientTenant: { id: TenantId; source: "header" | "cookie" } | null =
    headerCheck.tenantId !== null
      ? { id: headerCheck.tenantId, source: "header" }
      : cookieCheck.tenantId !== null
        ? { id: cookieCheck.tenantId, source: "cookie" }
        : null;

  // Step 3: pick the authoritative tenant.
  const resolved = await resolveTenant(c, config, clientTenant);
  if ("error" in resolved) return middlewareReject(c, resolved.error);

  // Step 4: existence check for untrusted sources.
  if (resolved.source !== "default" && config.tenantExists) {
    const exists = await config.tenantExists(resolved.tenantId);
    if (!exists) {
      return middlewareReject(c, {
        code: "tenant_not_found",
        status: 404,
        message: `tenant "${resolved.tenantId}" does not exist`,
        i18nKey: "auth.errors.tenantNotFound",
        details: { tenantId: resolved.tenantId },
      });
    }
  }

  // Step 5: synthesise + continue.
  const lifecycleReject = await rejectIfTenantTeardown(
    c,
    resolved.tenantId,
    resolveTenantLifecycleStatus,
  );
  if (lifecycleReject) return lifecycleReject;
  c.set(USER_KEY, createAnonymousUser(resolved.tenantId));
  await next();
  // skip: anonymous path completed — Hono middleware contract returns void
  // when next() ran; explicit return makes the union return-type honest.
  return;
}

// Validates an X-Tenant / cookie value against the tenantId format. Returns
// `{tenantId: null}` when absent, `{tenantId: TenantId}` when valid, or
// `{error: …}` when the value is non-empty junk (so the caller can return
// 400 instead of silently treating it as "no tenant supplied").
function parseClientTenant(
  raw: string | undefined,
  source: string,
): { tenantId: TenantId | null; error?: never } | { tenantId?: never; error: RejectArgs } {
  if (raw === undefined || raw === "") return { tenantId: null };
  const parsed = parseTenantId(raw);
  if (parsed === null) {
    return {
      error: {
        code: "invalid_tenant_format",
        status: 400,
        message: `${source} is not a valid tenant id`,
        i18nKey: "auth.errors.invalidTenantFormat",
        details: { source, value: raw },
      },
    };
  }
  return { tenantId: parsed };
}

type ResolvedTenant = { tenantId: TenantId; source: TenantSource };
type ResolveError = { error: RejectArgs };

// Implements the "client tenant vs default" precedence. Single-tenant mode
// (defaultTenantId set) is **locked**: the client either agrees with the
// default or gets tenant_mismatch — defending the deployment from confused
// clients that think they're talking to a different installation.
async function resolveTenant(
  c: Context,
  config: AnonymousAccessConfig,
  clientTenant: { id: TenantId; source: "header" | "cookie" } | null,
): Promise<ResolvedTenant | ResolveError> {
  if (config.defaultTenantId !== undefined) {
    return resolveAgainstDefault(config.defaultTenantId, clientTenant);
  }
  if (config.tenantResolver && config.resolverTrust === "authoritative") {
    return await resolveWithAuthoritativeResolver(c, config.tenantResolver, clientTenant);
  }
  return await resolveWithClientPrecedence(c, config.tenantResolver, clientTenant);
}

// Locked single-tenant mode: the client either agrees with the default or
// gets tenant_mismatch — defending the deployment from confused clients
// that think they're talking to a different installation.
function resolveAgainstDefault(
  defaultTenantId: TenantId,
  clientTenant: { id: TenantId; source: "header" | "cookie" } | null,
): ResolvedTenant | ResolveError {
  if (clientTenant && clientTenant.id !== defaultTenantId) {
    return {
      error: {
        code: "tenant_mismatch",
        status: 400,
        message: `${clientTenant.source} tenant disagrees with server default`,
        i18nKey: "auth.errors.tenantMismatch",
        details: { clientTenantId: clientTenant.id, defaultTenantId },
      },
    };
  }
  return { tenantId: defaultTenantId, source: "default" };
}

// resolverTrust: "authoritative" — the resolver is trusted over the client.
// A client-supplied tenant that disagrees is rejected, never used to
// override the resolver's answer. Falls back to the client tenant only
// when the resolver itself has no opinion (unrecognised host).
async function resolveWithAuthoritativeResolver(
  c: Context,
  tenantResolver: TenantResolver,
  clientTenant: { id: TenantId; source: "header" | "cookie" } | null,
): Promise<ResolvedTenant | ResolveError> {
  const resolved = await tenantResolver(c);
  if (resolved !== null && resolved !== undefined) {
    if (clientTenant && clientTenant.id !== resolved) {
      return {
        error: {
          code: "tenant_mismatch",
          status: 400,
          message: `${clientTenant.source} tenant disagrees with resolved tenant`,
          i18nKey: "auth.errors.tenantMismatch",
          details: { clientTenantId: clientTenant.id, resolvedTenantId: resolved },
        },
      };
    }
    return { tenantId: resolved, source: "resolver" };
  }
  // Resolver had no opinion (unrecognised host) — do NOT fall back to the
  // client-supplied tenant here. That would let an unrecognised-host
  // request pick its own tenant via X-Tenant, the exact override this mode
  // exists to prevent; it's just reached through "unknown host" instead of
  // "known host, disagreeing header". Authoritative means the resolver's
  // silence is final, not a delegation back to the client.
  return tenantRequiredError();
}

// resolverTrust: "fallback-only" (or no resolver at all) — client tenant
// wins outright; the resolver only runs as a last resort when neither
// header nor cookie supplied a value.
async function resolveWithClientPrecedence(
  c: Context,
  tenantResolver: TenantResolver | undefined,
  clientTenant: { id: TenantId; source: "header" | "cookie" } | null,
): Promise<ResolvedTenant | ResolveError> {
  if (clientTenant) {
    return { tenantId: clientTenant.id, source: clientTenant.source };
  }
  if (tenantResolver) {
    const resolved = await tenantResolver(c);
    if (resolved !== null && resolved !== undefined) {
      return { tenantId: resolved, source: "resolver" };
    }
  }
  return tenantRequiredError();
}

function tenantRequiredError(): ResolveError {
  return {
    error: {
      code: "tenant_required",
      status: 400,
      message:
        "anonymous access requires a tenant (X-Tenant header, kumiko_tenant cookie, or server-side resolver)",
      i18nKey: "auth.errors.tenantRequired",
    },
  };
}

type RejectArgs = {
  code: MiddlewareRejectCode;
  status: 400 | 401 | 403 | 404 | 410;
  message: string;
  i18nKey: string;
  details?: Record<string, unknown>;
};

const TENANT_LIFECYCLE_BLOCKED = new Set([
  "destroyRequested",
  "destroying",
  "destroyFailed",
  "destroyed",
]);
const TENANT_LIFECYCLE_CANCEL_QN = "tenant-lifecycle:write:cancel-destruction";

async function requestsCancelDestruction(c: Context): Promise<boolean> {
  if (c.req.method !== "POST") return false;
  try {
    const path = c.req.path;
    const body = (await c.req.raw.clone().json()) as {
      type?: string;
      commands?: Array<{ type?: string }>;
    };
    if (path === "/api/write") {
      return body.type === TENANT_LIFECYCLE_CANCEL_QN;
    }
    if (path === "/api/batch") {
      // every(), not some(): a batch mixing the cancel command with other
      // writes must NOT wave the whole batch through the teardown gate —
      // only a batch consisting solely of cancel-destruction is exempt.
      return (
        Array.isArray(body.commands) &&
        body.commands.length > 0 &&
        body.commands.every((command) => command.type === TENANT_LIFECYCLE_CANCEL_QN)
      );
    }
  } catch {
    return false;
  }
  return false;
}

async function rejectIfTenantTeardown(
  c: Context,
  tenantId: TenantId,
  resolveTenantLifecycleStatus: TenantLifecycleStatusResolver | undefined,
): Promise<Response | undefined> {
  if (!resolveTenantLifecycleStatus) return undefined;
  const lifecycle = await resolveTenantLifecycleStatus(tenantId);
  if (!lifecycle || !TENANT_LIFECYCLE_BLOCKED.has(lifecycle.status)) return undefined;
  if (lifecycle.status === "destroyRequested" && (await requestsCancelDestruction(c))) {
    return undefined;
  }
  return middlewareReject(c, {
    code: "tenant_unavailable",
    status: 410,
    message: `tenant "${tenantId}" is unavailable (${lifecycle.status})`,
    i18nKey: "auth.errors.tenantUnavailable",
    details: { tenantId, status: lifecycle.status },
  });
}
