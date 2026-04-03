import type { Context, Next } from "hono";
import type { SessionUser } from "../engine/types";
import type { JwtHelper } from "./jwt";

const USER_KEY = "pipelineUser";

export function authMiddleware(jwt: JwtHelper) {
  return async (c: Context, next: Next) => {
    const header = c.req.header("Authorization");
    if (!header?.startsWith("Bearer ")) {
      return c.json({ error: "missing_token" }, 401);
    }

    const token = header.slice(7);
    try {
      const payload = await jwt.verify(token);
      const user: SessionUser = {
        id: payload.sub,
        tenantId: payload.tenantId,
        roles: payload.roles,
      };
      c.set(USER_KEY, user);
      await next();
    } catch {
      return c.json({ error: "invalid_token" }, 401);
    }
  };
}

export function getUser(c: Context): SessionUser {
  return c.get(USER_KEY) as SessionUser;
}
