import type { Context } from "hono";
import { matchedRoutes } from "hono/route";

export const UNMATCHED_ROUTE_LABEL = "unmatched";

const MIDDLEWARE_METHOD = "ALL";

// Route pattern (`/api/heartbeat/:token`) instead of the raw path: raw paths carry path-param
// secrets and make every distinct id its own metric series. Middleware and the notFound fallback
// register as method "ALL", so only a method-specific match counts as a real route. Reading the
// match list instead of c.req.routeIndex keeps the label right when a middleware (401, 429)
// answers before the handler runs.
export function resolveRouteLabel(c: Context): string {
  const routes = matchedRoutes(c);
  for (let index = routes.length - 1; index >= 0; index--) {
    const route = routes[index];
    if (route && route.method !== MIDDLEWARE_METHOD) return route.path;
  }
  return UNMATCHED_ROUTE_LABEL;
}
