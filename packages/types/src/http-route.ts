// HTTP route definition — feature-declared HTTP endpoints outside
// the /api/write|query|batch pipeline. Use case: RSS/Atom feeds, OpenAPI
// specs, OG image generators, webhook receivers — anything where the
// feature author controls the wire format themselves.
//
// Pattern symmetric to r.queryHandler / r.writeHandler: definition as
// part of the feature (not the app bootstrapping). Multi-tenant support
// becomes trivial because tenant context is picked up via host resolution.
//
// Escape-hatch stays: runProdApp.extraRoutes (declarative list with
// `entry` tier) for hand-rolled routes that have nothing to do with a
// feature (e.g. platform-specific static-serving logic).

import type { Context } from "hono";
import type { RateLimitOption } from "./handlers.ts";

/** Subset of HTTP methods actively supported. Hono supports all methods,
 *  but these are the only ones a feature author is expected to declare. */
export type HttpRouteMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";

/** Dependencies provided to the handler by the framework. The app can be
 *  called directly (`deps.app.fetch(...)` for internal calls), or data can
 *  be fetched through the dispatcher. Db/Redis are raw connections — tenant
 *  scoping requires going through dispatcher.query.
 *
 *  Hono typing: `Context<any, any>` is used because Hono's type-parameter
 *  setup is only relevant internally. The concrete Hono app is assigned
 *  during boot. */
export type HttpRouteHandlerDeps = {
  /** The Hono app — the handler can use app.fetch(...) to call internal routes
   *  (e.g. /api/query with the full auth/anonymous chain). */
  // biome-ignore lint/suspicious/noExplicitAny: Hono's generic parameter is invisible at the framework boundary
  readonly app: import("hono").Hono<any, any>;
  /** Run a query handler in-process, forcing a SPECIFIC tenant — WITHOUT
   *  going through the public /api/query HTTP layer (no header parsing, no
   *  anonymousAccess tenant resolution). The synthesized caller carries
   *  anonymous-level access ONLY (same role a real anonymous request would
   *  have, no more) — the primitive forces the tenant, not the privilege
   *  level, so it stays safe to call from any `anonymous: true` route
   *  without risking a field-level disclosure a real anonymous caller
   *  couldn't already get. Use this whenever the route needs a tenant
   *  other than the one the request resolves to (e.g. always
   *  SYSTEM_TENANT_ID regardless of the visited host) — spoofing that via
   *  an internal X-Tenant header on `app.fetch(...)` is indistinguishable
   *  from an external client and gets rejected by resolverTrust:
   *  "authoritative" anonymousAccess configs (see auth-middleware.ts). */
  readonly systemQuery: (
    type: string,
    payload: unknown,
    tenantId: import("./identifiers.ts").TenantId,
  ) => Promise<unknown>;
  /** Caller IP resolved via the server's configured, trustedProxyHops-aware
   *  resolver (same one requestIdMiddleware uses for `/api/*`) — a route
   *  handler needing the caller's IP (rate limiting, audit) should read
   *  this instead of parsing X-Forwarded-For itself, which trusts
   *  whichever hop count the deployment actually has in front of it. */
  readonly clientIp: string;
};

export type HttpRouteHandler = (
  // biome-ignore lint/suspicious/noExplicitAny: Hono Context generics are invisible at the framework boundary
  c: Context<any, any>,
  deps: HttpRouteHandlerDeps,
) => Response | Promise<Response>;

/** Same shape as a handler's `rateLimit`, restricted to the IP-keyed
 *  buckets: a route has no dispatcher identity to key on. `"ip+handler"`
 *  keeps one bucket per route ("METHOD path"), `"ip"` shares one across
 *  every route that declares it. */
export type HttpRouteRateLimit = Omit<RateLimitOption, "per"> & {
  readonly per: "ip" | "ip+handler";
};

export type HttpRouteDefinition = {
  /** HTTP method — mounted in Hono via app.{get,post,...}(path). */
  readonly method: HttpRouteMethod;
  /** URL path (Hono pattern, e.g. "/feed.xml" or "/og/:tenantId.png"). */
  readonly path: string;
  /** true = public, no session required. false = mounted behind the
   *  session auth chain (global IP rate limit when configured, PII
   *  ciphertext tripwire, no anonymous fallthrough, origin + CSRF guards;
   *  PATs are rejected). requestId, body limit and observability are the
   *  `/api/*` chain only. A request without a session gets 401. The
   *  handler reads the caller via getUser(c). */
  readonly anonymous: boolean;
  /** Hono handler. Receives the Hono context and framework dependencies;
   *  returns a Response synchronously or asynchronously. */
  readonly handler: HttpRouteHandler;
  /** Enforced before the route's guards through the server's rate-limit
   *  resolver (fail-open like the global L1 limiter: a limiter outage
   *  lets the request through, counted and logged). */
  readonly rateLimit?: HttpRouteRateLimit;
};
