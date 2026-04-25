import type { Context, Next } from "hono";
import { getCookie } from "hono/cookie";
import { createAnonymousUser } from "../engine/system-user";
import type { SessionUser, TenantId } from "../engine/types";
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

// Which wire the current request authenticated over. Downstream
// csrf-middleware reads this: cookie-auth gets a CSRF-token check, bearer
// does not (headers aren't set cross-origin by browsers, so there is no
// CSRF vector on a bearer-only client).
export type AuthTransport = "cookie" | "bearer";

// Status of a sid from the server's perspective. The sessions feature owns
// the DB-backed implementation; middleware just consults whatever function
// the app wires in.
export type AuthSessionStatus = "live" | "revoked" | "expired" | "missing";

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

export type AuthMiddlewareOptions = {
  // Called after JWT-verify when the token carries a sid. If the checker
  // reports anything other than "live", the request is rejected with 401.
  // Omit to run in stateless-JWT mode (any valid JWT is accepted).
  readonly sessionChecker?: AuthSessionChecker;
  // When true, a JWT WITHOUT a sid is rejected. Leave false during rollout
  // so already-issued stateless JWTs keep working until they expire; flip
  // to true once the server has been emitting sid for longer than the JWT
  // TTL. Has no effect when sessionChecker is undefined.
  readonly strictMode?: boolean;
  // Opt-in: when set, requests without a JWT are treated as anonymous
  // callers instead of being rejected with 401. The middleware synthesises
  // a SessionUser with id="anonymous" and roles=["anonymous"], scoped to a
  // tenantId resolved through the chain documented on AnonymousAccessConfig.
  readonly anonymousAccess?: AnonymousAccessConfig;
};

// Resolves the tenant for an unauthenticated request. Returns null when no
// tenant can be determined — the middleware then falls through to the next
// link in the chain (defaultTenantId) or rejects with 400.
// Throw only on infrastructure failures (DB down, cache broken) — those
// surface as 500. "Subdomain unknown" is null, not throw.
export type TenantResolver = (c: Context) => Promise<TenantId | null> | TenantId | null;

// Returns true when the tenantId names an active tenant. Used after
// header/cookie/resolver to confirm the caller-supplied id is real before a
// SessionUser is synthesised. Omit to skip validation (e.g. single-tenant
// apps that already vet defaultTenantId at boot).
export type TenantValidator = (tenantId: TenantId) => Promise<boolean> | boolean;

export type AnonymousAccessConfig = {
  // Resolution chain (first non-null wins):
  //   1. JWT-tenantId (when a token is present — anonymous path is skipped)
  //   2. X-Tenant header
  //   3. kumiko_tenant cookie
  //   4. tenantResolver(req)         — custom (e.g. subdomain parser)
  //   5. defaultTenantId             — single-tenant apps' shortcut
  // No tenant resolved → 400 "tenant_required".
  readonly tenantResolver?: TenantResolver;
  // Trusted as-is on the request path — there is no boot-time DB lookup.
  // Set this to a tenantId you control (single-tenant deployments) and
  // verify it at app-boot before passing it in (see sample for the pattern).
  readonly defaultTenantId?: TenantId;
  // Per-request existence check for header/cookie/resolver-supplied ids.
  // Defaults to "trust the value" — fine for prototypes, NOT for production
  // multi-tenant deployments where a caller could probe arbitrary ids.
  readonly tenantValidator?: TenantValidator;
};

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
  | "tenant_mismatch";

function middlewareReject(
  c: Context,
  opts: {
    code: MiddlewareRejectCode;
    status: 400 | 401 | 403 | 404;
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
  const { sessionChecker, strictMode = false, anonymousAccess } = options;

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
      if (anonymousAccess) {
        return await handleAnonymous(c, anonymousAccess, next);
      }
      return middlewareReject(c, {
        code: "missing_token",
        status: 401,
        message: "no auth cookie or bearer token",
        i18nKey: "auth.errors.missingToken",
      });
    }
    const { token, transport } = extracted;

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
    // token carries a sid. strictMode governs the no-sid case below so that
    // both old JWTs (no sid) and rolling-deploy gaps can be handled.
    if (sessionChecker) {
      if (payload.jti) {
        const status = await sessionChecker(payload.jti, payload.sub);
        if (status !== "live") {
          return sessionInvalid(c, status);
        }
      } else if (strictMode) {
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
    c.set(USER_KEY, user);
    c.set(AUTH_TRANSPORT_KEY, transport);
    await next();
  };
}

export function getUser(c: Context): SessionUser {
  return c.get(USER_KEY) as SessionUser;
}

export function getAuthTransport(c: Context): AuthTransport | undefined {
  return c.get(AUTH_TRANSPORT_KEY) as AuthTransport | undefined;
}

// Anonymous request flow: resolve a tenant via header → cookie → resolver →
// default; reject with 400 (no tenant) or 404 (unknown tenant) when nothing
// produces a verified id; otherwise stamp an anonymous SessionUser and pass
// through. The transport flag stays unset so csrf-middleware skips the
// double-submit check (no auth-cookie ⇒ no CSRF vector to defend against).
async function handleAnonymous(
  c: Context,
  config: AnonymousAccessConfig,
  next: Next,
): Promise<Response | undefined> {
  const headerTenant = c.req.header(TENANT_HEADER_NAME);
  const cookieTenant = getCookie(c, TENANT_COOKIE_NAME);

  let candidate: string | undefined = headerTenant ?? cookieTenant;
  let mustValidate = candidate !== undefined;

  if (candidate === undefined && config.tenantResolver) {
    const resolved = await config.tenantResolver(c);
    if (resolved !== null && resolved !== undefined) {
      candidate = resolved;
      mustValidate = true;
    }
  }
  if (candidate === undefined && config.defaultTenantId !== undefined) {
    // defaultTenantId is trusted as configured — the framework does NOT
    // verify it against the DB at boot. Callers are responsible for setting
    // it to a real tenantId; a typo surfaces as an FK violation on the first
    // anonymous write. The sample wires a guard at app-boot instead of at
    // every request, which is the recommended pattern.
    candidate = config.defaultTenantId;
    mustValidate = false;
  }

  if (candidate === undefined) {
    return middlewareReject(c, {
      code: "tenant_required",
      status: 400,
      message:
        "anonymous access requires a tenant (X-Tenant header, kumiko_tenant cookie, or server-side resolver)",
      i18nKey: "auth.errors.tenantRequired",
    });
  }

  if (mustValidate && config.tenantValidator) {
    const exists = await config.tenantValidator(candidate as TenantId);
    if (!exists) {
      return middlewareReject(c, {
        code: "tenant_not_found",
        status: 404,
        message: `tenant "${candidate}" does not exist`,
        i18nKey: "auth.errors.tenantNotFound",
        details: { tenantId: candidate },
      });
    }
  }

  c.set(USER_KEY, createAnonymousUser(candidate as TenantId));
  await next();
  // skip: anonymous path completed — Hono middleware contract returns void
  // when next() ran; explicit return makes the union return-type honest.
  return;
}
