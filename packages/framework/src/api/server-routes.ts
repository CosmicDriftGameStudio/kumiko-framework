import type { Hono } from "hono";
import { createProjectingTenantDb } from "../db/tenant-db.ts";
import { isAnonymousSessionUser } from "../engine/system-user.ts";
import type { SessionUser } from "../engine/types/index.ts";

import type { FileRoutesOptions } from "../files/file-routes.ts";
import { createFileRoutes, readFilesRouteOptions } from "../files/file-routes.ts";
import { createRecordReadCheck } from "../files/record-read-check.ts";
import { createRecordWriteCheck } from "../files/record-write-check.ts";
import { createRateLimitResolver } from "../rate-limit/index.ts";
import { collectAnonymousLiveEntities } from "./anonymous-live-entities.ts";
import { NO_ROUTE_MATCH_HEADER_NAME } from "./api-constants.ts";
import { identifyOptionalSession } from "./auth-middleware.ts";
import { createAuthRoutes } from "./auth-routes.ts";
import { createClientErrorRoute } from "./client-error-route.ts";
import { collectEntityReadAccess, collectEntityRowReadMaps } from "./entity-read-access.ts";
import { createExportRoutes } from "./export/export-route.ts";
import { registerHealthRoutes, registerMetricsRoute } from "./route-registrars.ts";
import { createApiRoutes } from "./routes.ts";
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
  wiring: Pick<
    ServerWiring,
    "options" | "dispatcher" | "sseBroker" | "rateLimitResolver" | "tracedRedis"
  >,
): void {
  const { options, dispatcher, sseBroker, rateLimitResolver, tracedRedis } = wiring;
  const exportRateLimitResolver =
    rateLimitResolver ??
    (tracedRedis ? createRateLimitResolver({ redis: tracedRedis }) : undefined);
  app.route(
    "/api",
    createApiRoutes(dispatcher, {
      ...(options.sseHeartbeatMs !== undefined ? { sseHeartbeatMs: options.sseHeartbeatMs } : {}),
      ...(options.context.clock !== undefined ? { clock: options.context.clock } : {}),
    }),
  );
  app.route("/api", createExportRoutes(dispatcher, options.registry, exportRateLimitResolver));
  app.route(
    "/api",
    createSseRoute(sseBroker, {
      anonymousLiveEntities: collectAnonymousLiveEntities(options.registry),
      entityReadAccess: collectEntityReadAccess(options.registry),
      entityRowReadMaps: collectEntityRowReadMaps(options.registry),
    }),
  );
}

export function mountFileRoutes(
  app: Hono,
  wiring: Pick<
    ServerWiring,
    | "options"
    | "dispatcher"
    | "fileProviderResolver"
    | "rateLimitResolver"
    | "tracedRedis"
    | "clientIpResolver"
  >,
): void {
  const { options, dispatcher, fileProviderResolver, rateLimitResolver, tracedRedis } = wiring;
  const fileRateLimitResolver =
    rateLimitResolver ??
    (tracedRedis ? createRateLimitResolver({ redis: tracedRedis }) : undefined);
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
        ...(fileRateLimitResolver ? { rateLimitResolver: fileRateLimitResolver } : {}),
        clientIpResolver: wiring.clientIpResolver,
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
