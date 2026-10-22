import type { Hono, MiddlewareHandler } from "hono";
import { createProjectingTenantDb } from "../db/tenant-db.ts";
import { buildAppSchema } from "../engine/build-app-schema.ts";
import { projectAppSchemaForRoles } from "../engine/project-app-schema-for-roles.ts";
import {
  resolveDisabledFeatureNames,
  stripDisabledFeaturesFromAppSchema,
} from "../engine/strip-disabled-features-from-app-schema.ts";
import { createAnonymousUser, isAnonymousSessionUser } from "../engine/system-user.ts";
import type {
  HttpRouteDefinition,
  HttpRouteMethod,
  SessionUser,
  TenantId,
} from "../engine/types/index.ts";
import type { FileRoutesOptions } from "../files/file-routes.ts";
import { createFileRoutes, readFilesRouteOptions } from "../files/file-routes.ts";
import { createRecordReadCheck } from "../files/record-read-check.ts";
import { createRecordWriteCheck } from "../files/record-write-check.ts";
import type { Dispatcher } from "../pipeline/dispatcher.ts";
import { createRateLimitResolver, httpRouteRateLimit } from "../rate-limit/index.ts";
import type { AppSchema } from "../ui-types/app-schema.ts";
import { assertUnreachable } from "../utils/index.ts";
import { collectAnonymousLiveEntities } from "./anonymous-live-entities.ts";
import { NO_ROUTE_MATCH_HEADER_NAME, Routes } from "./api-constants.ts";
import { getUser, identifyOptionalSession } from "./auth-middleware.ts";
import { createAuthRoutes } from "./auth-routes.ts";
import { createClientErrorRoute } from "./client-error-route.ts";
import { type ClientIpResolver, clientIpSourceFromHonoContext } from "./client-ip.ts";
import { collectEntityReadAccess } from "./entity-read-access.ts";
import { computeStrongEtag, etagMatches } from "./http-cache.ts";
import { requestContext } from "./request-context.ts";
import { buildRequestContextData } from "./request-id-middleware.ts";
import { registerHealthRoutes, registerMetricsRoute } from "./route-registrars.ts";
import { createApiRoutes } from "./routes.ts";
import type { ServerOptions } from "./server.ts";
import { assertSinglePrincipalStatusProvider } from "./server-boot-checks.ts";
import type { ServerWiring } from "./server-wiring.ts";
import type { ResolvedSessionCookies } from "./session-cookies.ts";
import { createSseRoute } from "./sse-route.ts";

export function mountOperationalRoutes(
  app: Hono,
  wiring: Pick<ServerWiring, "options" | "baseDb" | "eventConsumers" | "observability" | "bootLog">,
): void {
  const { options, baseDb, eventConsumers, observability, bootLog } = wiring;
  registerHealthRoutes(app, {
    lifecycle: options.lifecycle,
    readiness: {
      db: baseDb,
      redis: options.context.redis,
      consumers: eventConsumers,
      ...(options.readiness ?? {}),
    },
  });

  if (options.metrics) {
    registerMetricsRoute(app, observability.meter, options.metrics);
  } else if (process.env["NODE_ENV"] === "production") {
    bootLog.warn(
      "/metrics is off: no `metrics` option, so nothing is measured or scraped. " +
        "Set PROMETHEUS_METRICS_TOKEN (min 32 chars) and spread resolveObservabilityWiring(token) into the server options.",
    );
  }
}

export function mountAuthRoutes(
  app: Hono,
  wiring: Pick<ServerWiring, "options" | "dispatcher" | "jwt" | "clientIpResolver">,
  sessionCookies: ResolvedSessionCookies,
): void {
  const { options, dispatcher, jwt, clientIpResolver } = wiring;
  if (options.auth) {
    assertSinglePrincipalStatusProvider(options.registry, options.auth);
    app.route(
      "/api",
      createAuthRoutes(dispatcher, jwt, {
        ...options.auth,
        secureCookies: sessionCookies.secure,
        resolver: clientIpResolver,
      }),
    );
  }
}

export function mountClientErrorRoute(
  app: Hono,
  wiring: Pick<
    ServerWiring,
    "rateLimitResolver" | "tracedRedis" | "clientIpResolver" | "observability" | "jwt"
  >,
): void {
  const { rateLimitResolver, tracedRedis, clientIpResolver, observability, jwt } = wiring;
  app.route(
    "/api",
    createClientErrorRoute({
      resolver:
        rateLimitResolver ??
        (tracedRedis ? createRateLimitResolver({ redis: tracedRedis }) : undefined),
      clientIpResolver,
      meter: observability.meter,
      identifySession: (c) => identifyOptionalSession(c, jwt),
    }),
  );
}

export function mountDispatcherRoutes(
  app: Hono,
  wiring: Pick<ServerWiring, "options" | "dispatcher" | "sseBroker">,
): void {
  const { options, dispatcher, sseBroker } = wiring;
  app.route(
    "/api",
    createApiRoutes(dispatcher, {
      ...(options.sseHeartbeatMs !== undefined ? { sseHeartbeatMs: options.sseHeartbeatMs } : {}),
    }),
  );
  app.route(
    "/api",
    createSseRoute(sseBroker, {
      anonymousLiveEntities: collectAnonymousLiveEntities(options.registry),
      entityReadAccess: collectEntityReadAccess(options.registry),
    }),
  );
}

export function mountSchemaRoute(
  app: Hono,
  options: Pick<ServerOptions, "registry" | "dispatcherOptions" | "context">,
): void {
  // GET /api/schema — the only way a client obtains the AppSchema. Behind
  // jwtGuard (NON_PUBLIC_API_PATHS), so anonymousAccess's synthesised user
  // also gets rejected below — the schema never reaches an unauthenticated
  // caller. The FULL schema is built lazily once — the registry is
  // immutable for this server's lifetime, so it's the same on every
  // request — then projected per caller-role-set (a role only
  // sees the screens/navs/workspaces/content-collections it may reach,
  // not the whole app's schema) and cached per role key. Tenant is
  // deliberately NOT part of the key: the projection depends only on
  // roles, and per-tenant caching would grow unboundedly across tenants
  // that share the same role set. What IS part of the key: the sorted set of
  // features the caller's tenant has switched off (r.toggleable) — few
  // distinct sets, so the cache stays small. The resolver is read per request
  // because run{Dev,Prod}App fill it in after the server is built.
  let fullSchema: AppSchema | undefined;
  const projectedSchemaCache = new Map<string, { readonly json: string; readonly etag: string }>();
  app.get(`/api${Routes.schema}`, async (c) => {
    const user = getUser(c);
    if (isMissingOrAnonymousUser(user)) {
      return unauthenticatedResponse(c);
    }
    const effectiveFeatures = options.dispatcherOptions?.effectiveFeatures;
    const disabledFeatureNames =
      effectiveFeatures === undefined
        ? []
        : await resolveDisabledFeatureNames(options.registry, effectiveFeatures, user.tenantId);
    const roleKey = JSON.stringify([[...new Set(user?.roles ?? [])].sort(), disabledFeatureNames]);
    let cached = projectedSchemaCache.get(roleKey);
    if (cached === undefined) {
      if (fullSchema === undefined) {
        fullSchema = buildAppSchema(options.registry, {
          searchAdapterMissing: !options.context.searchAdapter,
        });
      }
      const projected = projectAppSchemaForRoles(
        stripDisabledFeaturesFromAppSchema(fullSchema, options.registry, disabledFeatureNames),
        user?.roles ?? [],
      );
      const json = JSON.stringify(projected);
      cached = { json, etag: computeStrongEtag(json) };
      projectedSchemaCache.set(roleKey, cached);
    }
    const cacheHeaders = { "Cache-Control": "private, no-cache", ETag: cached.etag };
    if (etagMatches(c.req.header("If-None-Match") ?? null, cached.etag)) {
      return c.body(null, 304, cacheHeaders);
    }
    return c.body(cached.json, 200, {
      "Content-Type": "application/json; charset=utf-8",
      ...cacheHeaders,
    });
  });
}

export function mountFileRoutes(
  app: Hono,
  wiring: Pick<ServerWiring, "options" | "dispatcher" | "fileProviderResolver">,
): void {
  const { options, dispatcher, fileProviderResolver } = wiring;
  // Mount upload/download routes whenever a file provider is resolvable (a
  // file-provider plugin is mounted, or a resolver was injected). They resolve
  // the provider per-tenant through file-foundation — no `files` option; route
  // policy comes from createFilesFeature(opts?). Gating on the resolver (not on
  // declared file fields) keeps unattached uploads working and matches the old
  // "files option present → routes" behavior.
  if (fileProviderResolver) {
    const fileDb = options.context.db as FileRoutesOptions["db"]; // @cast-boundary engine-bridge
    if (!fileDb) throw new Error("file routes require db in context");
    const routeOptions = readFilesRouteOptions(options.registry);
    const canReadRecord = createRecordReadCheck(options.registry, dispatcher.query);
    app.route(
      "/api",
      createFileRoutes({
        db: fileDb,
        registry: options.registry,
        resolveProvider: fileProviderResolver,
        canReadRecord,
        canWriteRecord: createRecordWriteCheck({
          registry: options.registry,
          canReadRecord,
          tenantDbFor: (tenantId) => createProjectingTenantDb(fileDb, tenantId, options.registry),
        }),
        ...(routeOptions.accessGuard ? { accessGuard: routeOptions.accessGuard } : {}),
        ...(routeOptions.privilegedRoles ? { privilegedRoles: routeOptions.privilegedRoles } : {}),
        ...(routeOptions.unclaimedUploadReaders
          ? { unclaimedUploadReaders: routeOptions.unclaimedUploadReaders }
          : {}),
        ...(routeOptions.maxUploadSize ? { maxUploadSize: routeOptions.maxUploadSize } : {}),
      }),
    );
  }
}

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
  // @wrapper-known semantic-alias
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

export function installNoRouteMatchMarker(app: Hono): void {
  // Marks "no route matched this path" so tryHonoFirst (server-runtime)
  // can tell it apart from a matched route's OWN deliberate 404 (e.g.
  // default-deny reads like file-derivatives' public-variant route) —
  // without this, tryHonoFirst's only signal was the status code, and a
  // matched route answering 404 got silently rewritten to the SPA shell
  // with status 200. Must be the LAST thing wired
  // on `app`: this only fires when the router found no handler at all, so
  // a route's own `c.text(..., 404)` never passes through here. A handler
  // that calls `c.notFound()` instead of building its own Response DOES
  // route through this same handler and stays indistinguishable from a
  // routing miss — pre-existing Hono semantics, not something this fix
  // changes; deliberate 404s must build their own Response.
  // The header is an internal signal only — tryHonoFirst and every direct
  // app.fetch() passthrough strip it before a response reaches a client.
  app.notFound((c) => c.text("Not Found", 404, { [NO_ROUTE_MATCH_HEADER_NAME]: "1" }));
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

// Shared by entry:"user" extra routes and GET /api/schema — both require a
// real, signed-in principal and reject the synthesised anonymousAccess user
// (SessionUser.roles includes ANONYMOUS_ROLE) the same way.
export function isMissingOrAnonymousUser(user: SessionUser | undefined): boolean {
  return !user || isAnonymousSessionUser(user);
}

export function unauthenticatedResponse(c: import("hono").Context): Response {
  return c.json(
    {
      error: {
        code: "unauthenticated",
        httpStatus: 401,
        message: "this route requires a signed-in user",
        i18nKey: "auth.errors.missingToken",
      },
    },
    401,
  );
}
