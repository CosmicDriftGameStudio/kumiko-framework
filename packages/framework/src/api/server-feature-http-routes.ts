import type { HttpRouteDefinition, HttpRouteMethod } from "@cosmicdrift/kumiko-types/http-route";
import type { Hono, MiddlewareHandler } from "hono";
import { createAnonymousUser } from "../engine/system-user.ts";
import type { TenantId } from "../engine/types/index.ts";
import type { Dispatcher } from "../pipeline/dispatcher.ts";
import { httpRouteRateLimit } from "../rate-limit/index.ts";
import { assertUnreachable } from "../utils/index.ts";
import { type ClientIpResolver, clientIpSourceFromHonoContext } from "./client-ip.ts";
import { requestContext } from "./request-context.ts";
import { buildRequestContextData } from "./request-id-middleware.ts";
import type { ServerWiring } from "./server-wiring.ts";

export function mountFeatureHttpRoutes(
  app: Hono,
  wiring: Pick<
    ServerWiring,
    "options" | "dispatcher" | "clientIpResolver" | "rateLimitResolver" | "observability"
  >,
  sessionOnlyHttpRouteGuards: readonly MiddlewareHandler[],
): void {
  // Feature-declared HTTP routes (r.httpRoute). Mount after /api/* so /api/* always
  // takes precedence; feature routes must be outside that prefix (the boot validator
  // enforces this). deps.app is the outer app, so the handler can call /api/query
  // internally through app.fetch(...) and use the same auth path as a real HTTP call.
  // deps.systemQuery deliberately bypasses that path for routes that must enforce a
  // FIXED tenant (for example, legal-pages always uses SYSTEM_TENANT_ID), rather than
  // spoofing it through the X-Tenant header. That header looks like a normal client
  // header to anonymousAccess resolution, so resolverTrust: "authoritative" configs
  // correctly reject it as a tenant override.
  for (const feature of wiring.options.registry.features.values()) {
    for (const route of Object.values(feature.httpRoutes)) {
      mountFeatureHttpRoute(app, route, wiring, sessionOnlyHttpRouteGuards);
    }
  }
}

function mountFeatureHttpRoute(
  app: Hono,
  route: HttpRouteDefinition,
  wiring: Pick<
    ServerWiring,
    "dispatcher" | "clientIpResolver" | "rateLimitResolver" | "observability"
  >,
  sessionOnlyHttpRouteGuards: readonly MiddlewareHandler[],
): void {
  const { dispatcher, clientIpResolver, rateLimitResolver, observability } = wiring;
  const honoHandler = async (c: import("hono").Context): Promise<Response> =>
    route.handler(c, {
      app,
      // createAnonymousUser, NOT createSystemUser: systemQuery's
      // synthesized user must clear the SAME access gate a real
      // anonymous visitor would, no more — regardless of the route's
      // own `anonymous` mode. The system role would ALSO satisfy that
      // gate here, but it can read fields gated to "system" that
      // "anonymous" can't (filterReadFields is a plain role-in-map
      // check) — a systemQuery caller reading a system-gated field
      // would leak it into the response. The forced tenant already
      // comes from bypassing the HTTP layer entirely; no elevated
      // role is needed or wanted on top of that.
      systemQuery: makeSystemQuery(c, dispatcher, clientIpResolver),
      clientIp: clientIpResolver.resolve(clientIpSourceFromHonoContext(c)),
    });
  // Without a resolver (no Redis in the context — dev/test stacks) the
  // declared limit is skipped rather than failing the boot of every app
  // that mounts a bundled feature whose routes carry a default limit.
  const routeLimit =
    route.rateLimit && rateLimitResolver
      ? [
          httpRouteRateLimit({
            resolver: rateLimitResolver,
            rateLimit: route.rateLimit,
            routeKey: `${route.method} ${route.path}`,
            clientIpResolver,
            meter: observability.meter,
          }),
        ]
      : [];
  mountHonoRoute(app, route.method, route.path, honoHandler, [
    ...routeLimit,
    ...(route.anonymous ? [] : sessionOnlyHttpRouteGuards),
  ]);
}

// Method-switch shared by r.httpRoute and extraRoutes — one place to keep
// the two mounting paths from drifting on which Hono methods get a
// convenience-call vs. app.on().
export function mountHonoRoute(
  app: Hono,
  method: HttpRouteMethod,
  path: string,
  // biome-ignore lint/suspicious/noExplicitAny: Hono context generics are invisible at the framework boundary
  handler: (c: import("hono").Context<any, any>) => Response | Promise<Response>,
  middlewares: readonly MiddlewareHandler[] = [],
): void {
  // Guards go into the route's own handler chain, never a method-gated
  // app.use: Hono serves HEAD through the GET route with c.req.method still
  // "HEAD", so a `method === c.req.method` gate would skip them for HEAD.
  if (middlewares.length > 0) {
    // [path]: only Hono's array-path overload accepts a variable-length handler spread.
    app.on(method, [path], ...middlewares, handler);
    // skip: guarded route already mounted with its guard chain
    return;
  }
  switch (method) {
    case "GET":
      app.get(path, handler);
      break;
    case "POST":
      app.post(path, handler);
      break;
    case "PUT":
      app.put(path, handler);
      break;
    case "PATCH":
      app.patch(path, handler);
      break;
    case "DELETE":
      app.delete(path, handler);
      break;
    case "OPTIONS":
    case "HEAD":
      // Hono's on() for the methods without a convenience method.
      app.on(method, path, handler);
      break;
    default:
      assertUnreachable(method, "http method");
  }
}

// Shared systemQuery builder for r.httpRoute and extraRoutes (anonymous +
// signature entries). requestContext.run must wrap the dispatcher call —
// both route kinds run outside the requestIdMiddleware chain that normally
// populates it, and `rateLimit: {per: "ip", ...}` on a handler invoked
// through systemQuery is otherwise silent dead-code (enforceRateLimit reads
// requestContext.get()?.ip, undefined without this wrap).
export function makeSystemQuery(
  // biome-ignore lint/suspicious/noExplicitAny: Hono context generics are invisible at the framework boundary
  c: import("hono").Context<any, any>,
  dispatcher: Dispatcher,
  clientIpResolver?: ClientIpResolver,
): (type: string, payload: unknown, tenantId: TenantId) => Promise<unknown> {
  return (type, payload, tenantId) =>
    requestContext.run(requestContext.get() ?? buildRequestContextData(c, clientIpResolver), () =>
      dispatcher.query(type, payload, createAnonymousUser(tenantId)),
    );
}
