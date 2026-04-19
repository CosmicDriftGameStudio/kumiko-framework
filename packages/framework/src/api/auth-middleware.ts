import type { Context, Next } from "hono";
import type { SessionUser } from "../engine/types";
import type { JwtHelper } from "./jwt";

const USER_KEY = "pipelineUser";

// Status of a sid from the server's perspective. The sessions feature owns
// the DB-backed implementation; middleware just consults whatever function
// the app wires in.
export type AuthSessionStatus = "live" | "revoked" | "expired" | "missing";
export type AuthSessionChecker = (sid: string) => Promise<AuthSessionStatus>;

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
        const status = await sessionChecker(payload.jti);
        if (status !== "live") {
          return c.json({ error: "session_invalid", reason: status }, 401);
        }
      } else if (strictMode) {
        return c.json({ error: "session_invalid", reason: "no_sid" }, 401);
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
