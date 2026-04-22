import type { Context, Next } from "hono";
import { getCookie } from "hono/cookie";
import type { SessionUser } from "../engine/types";
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
  | "session_invalid";

function middlewareReject(
  c: Context,
  opts: {
    code: MiddlewareRejectCode;
    status: 400 | 401 | 403;
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
  const { sessionChecker, strictMode = false } = options;

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
