import type { Context, Next } from "hono";
import type { SessionUser } from "../engine/types";
import type { JwtHelper } from "./jwt";

const USER_KEY = "pipelineUser";

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
// dispatcher path — clients that already parse `{error: {code, details}}`
// from handler responses don't need a second parser for middleware rejects.
function sessionInvalid(c: Context, reason: AuthSessionStatus | "no_sid"): Response {
  return c.json(
    {
      error: {
        code: "session_invalid",
        httpStatus: 401,
        message: `session ${reason}`,
        i18nKey: "auth.errors.sessionInvalid",
        details: { reason },
      },
    },
    401,
  );
}

export function authMiddleware(jwt: JwtHelper, options: AuthMiddlewareOptions = {}) {
  const { sessionChecker, strictMode = false } = options;

  return async (c: Context, next: Next) => {
    const header = c.req.header("Authorization");
    if (!header?.startsWith("Bearer ")) {
      return c.json({ error: "missing_token" }, 401);
    }

    const token = header.slice(7);
    let payload: Awaited<ReturnType<JwtHelper["verify"]>>;
    try {
      payload = await jwt.verify(token);
    } catch {
      return c.json({ error: "invalid_token" }, 401);
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
    await next();
  };
}

export function getUser(c: Context): SessionUser {
  return c.get(USER_KEY) as SessionUser;
}
