import { Hono } from "hono";
import type { PgListenClient } from "../db/connection.ts";
import type { AppContext, Registry, RunIn } from "../engine/types/index.ts";
import type { ErrorDocsConfig } from "../errors/docs-url.ts";
import type { Lifecycle } from "../lifecycle/index.ts";
import type { ObservabilityProvider } from "../observability/index.ts";
import type { Dispatcher, DispatcherOptions } from "../pipeline/dispatcher.ts";
import type { EventDedup } from "../pipeline/event-dedup.ts";
import type { EventDispatcher } from "../pipeline/event-dispatcher.ts";
import type { SystemHooks } from "../pipeline/lifecycle-pipeline.ts";
import type {
  AuthEndpointRateLimitOptions,
  GlobalIpRateLimitOptions,
} from "../rate-limit/index.ts";
import type { AnonymousAccessResolved } from "./auth-middleware.ts";
import type { AuthRoutesConfig } from "./auth-routes.ts";
import type { ExtraRouteDefinition } from "./extra-route.ts";
import type { JwtHelper, JwtKeyring } from "./jwt.ts";
import {
  DEFAULT_MAX_REQUEST_BYTES,
  registerBodyLimit,
  registerVersionRoute,
} from "./route-registrars.ts";
import { handleUncaughtRouteError } from "./routes.ts";
import { compilePublicApiRequestMatcher, mountExtraRoutes } from "./server-extra-routes.ts";
import {
  installAuthGuardChain,
  installObservability,
  installPiiLeakGuard,
  installRateLimitMiddleware,
  installRequestId,
  installSessionCookies,
} from "./server-middleware.ts";
import {
  installNoRouteMatchMarker,
  mountAuthRoutes,
  mountClientErrorRoute,
  mountDispatcherRoutes,
  mountFeatureHttpRoutes,
  mountFileRoutes,
  mountOperationalRoutes,
  mountSchemaRoute,
} from "./server-routes.ts";
import { mountWebSocketRoutes } from "./server-websocket-routes.ts";
import { resolveServerWiring } from "./server-wiring.ts";
import type { SseBroker } from "./sse-broker.ts";

export type ServerOptions = {
  registry: Registry;
  context: AppContext;
  jwtSecret: string | JwtKeyring;
  jwtIssuer?: string;
  // JWT lifetime in seconds. Explicit always wins. When omitted, the default
  // depends on `auth.sessionChecker`: wired (revocation possible) keeps the
  // long-lived 24h default; unwired (stateless JWTs, no revocation) drops to
  // 1h so a leaked stateless token has a much smaller exposure window.
  jwtTtl?: number;
  dispatcherOptions?: Omit<DispatcherOptions, "lifecycle">;
  systemHooks?: SystemHooks;
  eventDedup?: EventDedup;
  sseBroker?: SseBroker;
  auth?: AuthRoutesConfig;
  // Number of trusted reverse-proxy hops for client-IP resolution — feeds
  // requestIdMiddleware's `ip`, the L1/L2 rate-limit middleware, and
  // createAuthRoutes. Wins over the
  // deprecated `auth.trustedProxyHops`. Default 0 = trust no proxy header,
  // only the socket address (or "unknown") counts — see client-ip.ts.
  trustedProxyHops?: number;
  /** Links the app's own error reasons to its own docs (`docsUrl` in error responses). Framework reasons keep linking to the framework docs. */
  errorDocs?: ErrorDocsConfig;
  // No `files` option: file-storage is wired by mounting `file-foundation` +
  // a `file-provider-*` feature. Upload routes, ctx.files and the GDPR jobs
  // resolve the provider per-tenant through that single source.
  // Upload-route policy (accessGuard/privilegedRoles/maxUploadSize) lives on
  // `createFilesFeature(opts?)`.
  // Async event-dispatcher config. The dispatcher is created automatically
  // when (a) context.db is a DbConnection AND (b) at least one consumer is
  // wired — SSE (iff sseBroker), Search (iff context.searchAdapter), or
  // feature-level r.multiStreamProjection consumers.
  //
  // Mirrors the old outboxPoller contract: `KumikoServer.eventDispatcher` is
  // created but NOT auto-started. Production boot must call `.start()`;
  // shutdown must call `.stop()`. Tests prefer `.runOnce()` for determinism
  // and skip `.start()` entirely.
  eventDispatcher?: {
    pollIntervalMs?: number;
    batchSize?: number;
    maxAttempts?: number;
    rearmCooldownMs?: number;
    maxRearmCount?: number;
    // Opt out of building the dispatcher even if consumers exist — e.g. ops
    // runs a dedicated dispatcher process, or a test needs to control the
    // consumer lifecycle manually.
    disabled?: boolean;
    // Opt out of the auto-built system consumers (SSE, Search, Job-Trigger)
    // while still running feature r.multiStreamProjection consumers. Useful
    // for tests that assert only on subscriber behaviour, or for a
    // deployment that routes SSE via a different transport. Default: sse/
    // search enabled when the respective dependency (sseBroker /
    // context.searchAdapter) is available; jobTrigger enabled when a
    // jobRunner is wired via dispatcherOptions.
    systemConsumers?: {
      sse?: boolean;
      search?: boolean;
      jobTrigger?: boolean;
      accessInvalidation?: boolean;
    };
    // LISTEN-capable client (postgres-js) for NOTIFY wake-up. When
    // present, `.start()` subscribes to EVENTS_PUBSUB_CHANNEL — delivery
    // latency drops from pollIntervalMs to TCP-round-trip. The poll timer
    // stays on as a safety net. Typically wired from
    // `createConnection(url).client`.
    pgClient?: PgListenClient;
  };
  // Observability: tracer + meter used for auto-instrumentation across
  // HTTP, dispatcher, pipeline, DB. Omitted => NoopProvider (zero overhead,
  // no spans or metrics emitted). Typically set to a ConsoleProvider in dev,
  // OTLPProvider in prod.
  observability?: ObservabilityProvider;
  // L1/L2 rate-limit middleware. Both layers share the auto-wired
  // resolver (or `context.rateLimit` if you provided one). Layers are
  // independent — wire only what you need:
  //   - `global`: gates every /api/* request by client IP. Use behind
  //     Cloudflare-less deployments to absorb naive floods at the edge
  //     of the app process.
  //   - `auth`: gates a single path-pattern (default `/api/auth/*`)
  //     with tighter limits. Typically `limit: 5, windowSeconds: 60`
  //     to slow brute-force without breaking real users. GET /api/auth/tenants
  //     (session read, called on every page load) is always exempt — see
  //     AUTH_RATE_LIMIT_EXEMPT_ROUTES in api-constants.ts.
  // Both omitted → no L1/L2 wired and no resolver auto-built unless an
  // L3 handler declared `rateLimit:`. This keeps zero-cost when unused.
  rateLimit?: {
    readonly global?: Omit<GlobalIpRateLimitOptions, "resolver">;
    readonly auth?: Omit<AuthEndpointRateLimitOptions, "resolver"> & {
      // Path-pattern the L2 middleware applies to. Default `/api/auth/*`.
      // Override for apps with a different auth route layout. The
      // GET /api/auth/tenants exemption above applies regardless of `path`.
      readonly path?: string;
    };
  };
  // Hard cap on JSON request bodies in bytes. Applied to /api/write,
  // /api/batch, /api/query, /api/command and /api/auth/*. File uploads
  // (/api/files) are excluded — those have their own per-field maxSize.
  // `undefined` → 1 MB default. `0` disables the limit entirely (tests
  // or bespoke deployments with a reverse-proxy that caps upstream).
  maxRequestBytes?: number;
  // SSE heartbeat interval for POST /api/stream (ms). Omit → framework default.
  // Tune down behind proxies with aggressive idle timeouts.
  sseHeartbeatMs?: number;
  // Process lifecycle. When present:
  //   - GET /health/ready reflects lifecycle.state() (200 ready / 503 else)
  //   - eventDispatcher.stop() is auto-registered as a shutdown hook, so
  //     lifecycle.drain() tears the poller down without the caller wiring it
  // Production main.ts passes `createLifecycle()`; tests that don't care
  // about drain() orchestration omit this and /health/ready stays absent.
  lifecycle?: Lifecycle;
  // Prometheus-scrape endpoint. When set, `/metrics` returns the current
  // accumulated metric state in OpenMetrics text format. Requires the
  // configured `observability` to use a PrometheusMeter (duck-typed via
  // the `snapshot` method) — otherwise the route returns 503 with a
  // note about misconfiguration. The optional `token` enforces
  // `Authorization: Bearer <token>`; without a token set the endpoint
  // is open (fine inside a private cluster, dangerous on the public
  // internet). Omit this option entirely to skip the route.
  metrics?: {
    readonly token?: string;
    readonly path?: string; // default "/metrics"
  };
  // /health/ready depth. When lifecycle is wired, the readiness handler
  // ALSO runs dependency checks before returning 200:
  //   - DB ping (auto-wired when context.db is a DbConnection)
  //   - Redis PING (auto-wired when context.redis is set)
  //   - Dispatcher consumer-lag (opt-in via maxDispatcherLag — off by default
  //     because a default threshold would false-503 small deployments that
  //     legitimately lag during bursts)
  // Checks run in parallel with a per-check timeout; any failed check drops
  // the probe to 503 with a JSON body listing which check failed.
  readiness?: {
    readonly timeoutMs?: number;
    readonly maxDispatcherLag?: bigint;
  };
  // Which deploy-lane this process runs — drives MSP-consumer filtering.
  //   "api":    picks up MSPs with runIn in {api, both}.
  //   "worker": picks up MSPs with runIn in {worker, both, undefined (default)}.
  //   "both":   all-in-one, no filtering — every MSP runs here.
  // When omitted, defaults to "worker" — preserves previous behaviour
  // (every MSP runs on the single dispatcher, wherever it lives).
  processLane?: RunIn;
  // Stable identifier for THIS process in the event-consumer state table.
  // Used as the `instance_id` on every per-instance consumer's cursor row.
  // Shared consumers ignore this and always write the reserved
  // sentinel. Default: `process.env.KUMIKO_INSTANCE_ID ?? generateId()`
  // — a fresh UUID at boot is fine for single-process deploys, but
  // multi-instance deploys SHOULD set KUMIKO_INSTANCE_ID to a stable
  // identifier (pod name, hostname) so ops can correlate lag metrics to
  // specific instances and can DELETE stale rows on scale-down. Must never
  // equal the sentinel; validator fails boot if it does.
  instanceId?: string;
  // Opt-in: serve unauthenticated requests on handlers that allow
  // roles=["anonymous"]. When omitted, every /api/* request still requires
  // a valid JWT (status quo). App-facing config is AnonymousAccessConfig
  // (defaultTenantId only); run{Prod,Dev}App merge auth-foundation tenant
  // providers into AnonymousAccessResolved before calling buildServer.
  anonymousAccess?: AnonymousAccessResolved;
  // Declarative HTTP routes outside the /api/write|query|batch pipeline that
  // still need the framework's dispatcher (webhooks, OAuth callbacks, admin
  // escape-hatches). Each entry declares its access tier (`entry`) up
  // front — buildServer wires the matching guard + deps, no handler gets a
  // raw db/redis. Mounted right after the r.httpRoute loop, before
  // registerVersionRoute.
  extraRoutes?: readonly ExtraRouteDefinition[];
};

export type KumikoServer = {
  app: Hono;
  jwt: JwtHelper;
  sseBroker: SseBroker;
  observability: ObservabilityProvider;
  // The command-dispatcher behind /api/* — same idempotency/jobRunner/
  // lifecycle wiring as HTTP-dispatched writes. For dispatching outside
  // the HTTP pipeline, e.g. provider-webhook routes that authenticate
  // via signature instead of JWT (subscription-stripe et al.).
  dispatcher: Dispatcher;
  // Present when at least one consumer is wired and context.db is a
  // DbConnection. Caller owns the lifecycle: `.start()` in boot, `.stop()`
  // in shutdown. Tests drain via `.runOnce()` instead.
  eventDispatcher?: EventDispatcher;
  // Echoed back so the caller has a single handle for both the app and the
  // lifecycle. Only set when the caller passed one in.
  lifecycle?: Lifecycle;
  // The AppContext every handler on this server sees — options.context plus
  // what buildServer wires onto it (_fileProviderResolver, rateLimit, the
  // observability tracer/meter). Callers that build a second consumer of the
  // same registry outside this server (a dev-server's job-runners) must pass
  // THIS, not their own pre-buildServer literal, or that consumer reaches for
  // fields only the request path has.
  context: AppContext;
};

export function buildServer(options: ServerOptions): KumikoServer {
  const wiring = resolveServerWiring(options);
  const app = new Hono();
  // Sub-apps mounted via app.route() without their own handler inherit this one.
  app.onError(handleUncaughtRouteError);
  // Hono runs middleware and routes in registration order, so the order below is behavior.
  // On "*" and first: auth routes, auth/csrf guards and tenant-cookie helpers read the names from the context.
  const sessionCookies = installSessionCookies(app, options.auth);
  const isPublicApiRequest = compilePublicApiRequestMatcher(options.extraRoutes);
  // /health and /metrics sit outside /api/*, so the /api/* guards below never run for them.
  mountOperationalRoutes(app, wiring);
  // First on /api/*: every later layer logs with the request id and client ip it sets.
  installRequestId(app, wiring);
  // O(1) header check before rate limit, auth and observability touch the body.
  registerBodyLimit(app, options.maxRequestBytes ?? DEFAULT_MAX_REQUEST_BYTES);
  // Before auth, so an unauthenticated flood never reaches JWT verify.
  const globalRateLimitGuard = installRateLimitMiddleware(app, wiring);
  // After the request id (the span carries it), before auth and routes (they run inside the span).
  installObservability(app, wiring.observability);
  // Before the auth chain, so its error responses pass the ciphertext tripwire too.
  installPiiLeakGuard(app);
  // jwt first: the PAT route scope, PAT rate limit and csrf guards read the principal it resolves.
  const authGuards = installAuthGuardChain(app, wiring, {
    isPublicApiRequest,
    globalRateLimitGuard,
  });
  // Before the generic /api routes: Hono serves the first match.
  mountAuthRoutes(app, wiring, sessionCookies);
  mountClientErrorRoute(app, wiring);
  mountDispatcherRoutes(app, wiring);
  mountSchemaRoute(app, options);
  mountFileRoutes(app, wiring);
  // Feature routes after /api/*, so the framework paths always win.
  mountFeatureHttpRoutes(app, wiring, authGuards.sessionOnlyHttpRouteGuards);
  mountWebSocketRoutes(app, wiring, authGuards.tenantLifecycleResolver);
  mountExtraRoutes(app, wiring);
  // After feature routes, so a feature-declared /version wins.
  registerVersionRoute(app);
  // Last: it may only fire when no route matched at all.
  installNoRouteMatchMarker(app);
  return {
    app,
    jwt: wiring.jwt,
    sseBroker: wiring.sseBroker,
    observability: wiring.observability,
    dispatcher: wiring.dispatcher,
    context: wiring.context,
    ...(wiring.eventDispatcher ? { eventDispatcher: wiring.eventDispatcher } : {}),
    ...(options.lifecycle ? { lifecycle: options.lifecycle } : {}),
  };
}
