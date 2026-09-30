import type { Context, MiddlewareHandler, Next } from "hono";
import { AccessDeniedError } from "../errors/index.js";
import { Routes } from "./api-constants.js";
import { getUser } from "./auth-middleware.js";

// Personal Access Tokens are minted for headless dispatcher access only.
// Every other /api/* surface (SSE, files, auth/*, feature httpRoutes,
// entry:"user" extraRoutes) must stay off-limits to a PAT regardless of its
// granted scopes — those routes never call assertPatAllowed, so without this
// guard a PAT with any scope (even an empty one) authenticates everywhere a
// cookie/JWT session would.
const PAT_ALLOWED_API_PATHS: ReadonlySet<string> = new Set([
  `/api${Routes.write}`,
  `/api${Routes.batch}`,
  `/api${Routes.query}`,
  `/api${Routes.command}`,
  `/api${Routes.stream}`,
]);

function isDispatcherPath(path: string): boolean {
  return PAT_ALLOWED_API_PATHS.has(path);
}

// Must run after an auth guard has resolved getUser(c) — same wiring point
// as buildPatRateLimitGuard. Cookie/JWT users (user.pat undefined) pass
// through untouched.
export function patRouteGuard(): MiddlewareHandler {
  return async (c: Context, next: Next) => {
    const user = getUser(c);
    if (user?.pat && !isDispatcherPath(c.req.path)) {
      const denied = new AccessDeniedError({
        message:
          "personal access tokens are only valid for the dispatcher API (write, batch, query, command, stream)",
        details: { reason: "pat_dispatcher_routes_only" },
      });
      return c.json(
        {
          error: {
            code: denied.code,
            httpStatus: denied.httpStatus,
            message: denied.message,
            i18nKey: denied.i18nKey,
            details: denied.details,
          },
        },
        403,
      );
    }
    return next();
  };
}
