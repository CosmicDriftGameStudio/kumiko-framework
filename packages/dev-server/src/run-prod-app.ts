// runProdApp — production-grade Bootstrap-Wrapper für Kumiko-Apps.
//
// Symmetrisch zu runDevApp, aber:
//   - DATABASE_URL / REDIS_URL / JWT_SECRET aus env (fail-fast bei Boot,
//     keine ephemeralen Test-DBs)
//   - Idempotente Migration: ensureEntityTable für jede Entity beim Boot.
//     Existiert die Tabelle schon, wird nichts gemacht. Schema-Drift-
//     Detection ist hier bewusst NICHT implementiert — Phase 4 bringt
//     versioned migrations via drizzle-kit.
//   - Idempotente Seeds: laufen nur wenn DB leer (über `isDbEmpty`-Probe
//     pro Seed). Re-Boots nach erstem Seed sind no-op.
//   - HTTP-Server via Bun.serve mit graceful SIGTERM/SIGINT → drain().
//   - Auth-Routes + bundled-features auto-mix wenn `auth:` gesetzt
//     (gleiche Logik wie runDevApp).
//
// App-Author schreibt:
//   await runProdApp({ features, auth, anonymousAccess, seeds });
//
// Container/Coolify setzt:
//   DATABASE_URL=postgresql://...
//   REDIS_URL=redis://...
//   JWT_SECRET=<random-32+>
//   PORT=3000
//   KUMIKO_INSTANCE_ID=<stable per replica>

import {
  AuthErrors,
  AuthHandlers,
  createAuthEmailPasswordFeature,
} from "@kumiko/bundled-features/auth-email-password";
import {
  type SeedAdminOptions,
  seedAdmin,
} from "@kumiko/bundled-features/auth-email-password/seeding";
import { createConfigFeature, createConfigResolver } from "@kumiko/bundled-features/config";
import { createTenantFeature, TenantQueries } from "@kumiko/bundled-features/tenant";
import { createUserFeature } from "@kumiko/bundled-features/user";
import { createDbConnection } from "@kumiko/framework/db";
import {
  buildAppSchema,
  createRegistry,
  type FeatureDefinition,
  validateBoot,
} from "@kumiko/framework/engine";
import {
  type ApiEntrypoint,
  type ApiEntrypointOptions,
  createApiEntrypoint,
} from "@kumiko/framework/entrypoint";
import { createArchivedStreamsTable, createEventsTable } from "@kumiko/framework/event-store";
import {
  createEntityCache,
  createEventConsumerStateTable,
  createEventDedup,
  createIdempotencyGuard,
  createProjectionStateTable,
} from "@kumiko/framework/pipeline";
import { ensureEntityTable } from "@kumiko/framework/testing";
import Redis from "ioredis";
import { ASSETS_DIR } from "./build-prod-bundle";

// Strict env-var read. Throws with a clear hint when missing — better
// than discovering a Postgres-connection-refused 30s into the boot.
function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(
      `runProdApp: required env var "${name}" is missing or empty. ` +
        `Set it in your container env / .env.production / Coolify secrets.`,
    );
  }
  return value;
}

// Optional env helper — returns undefined for missing, string for set.
// Used for KUMIKO_INSTANCE_ID, JWT_ISSUER and other "nice to have" knobs.
function readEnv(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value === "" ? undefined : value;
}

export type RunProdAppAuthOptions = {
  /** Initial admin user. Seeded once (idempotent — re-boots check first
   *  whether the email is already in the users table). */
  readonly admin: SeedAdminOptions;
  /** Optional override of the login error → HTTP status map. */
  readonly loginErrorStatusMap?: Readonly<Record<string, number>>;
};

/** Hook for app-specific seeding — runs after the admin (when auth is
 *  active). Each seed is responsible for its own idempotence (seeds are
 *  expected to check "is my row already there?" before inserting). */
export type ProdSeedFn = (deps: {
  db: import("@kumiko/framework/db").DbConnection;
}) => Promise<void>;

export type RunProdAppOptions = {
  /** App-specific features. config/user/tenant/auth-email-password are
   *  auto-mixed when `auth:` is set — don't add them yourself. */
  readonly features: readonly FeatureDefinition[];
  /** Listen-Port. Default 3000 (or $PORT). */
  readonly port?: number;
  /** Auth-mode: standard features + routes wired, admin seeded. */
  readonly auth?: RunProdAppAuthOptions;
  /** Custom seed functions, run after the admin seed (when auth-mode). */
  readonly seeds?: readonly ProdSeedFn[];
  /** Anonymous-access for public endpoints (same shape as runDevApp). */
  readonly anonymousAccess?: ApiEntrypointOptions["context"] extends infer _
    ? import("@kumiko/framework/api").ServerOptions["anonymousAccess"]
    : never;
  /** Static-file root for HTML / assets. Served on the catch-all route
   *  for any path that doesn't match an /api/ handler. Use this for the
   *  public status page HTML, embed widget JS, etc. */
  readonly staticDir?: string;
  /** Extra AppContext keys. configResolver is auto-set in auth-mode. */
  readonly extraContext?: Record<string, unknown>;
  /** Mount-Point für app-eigene HTTP-Routes außerhalb des Dispatcher-
   *  Systems. Aufgerufen NACH /api/* + /health, VOR der static-fallback —
   *  perfekt für GET-Endpoints die kein JSON liefern: /feed.xml,
   *  /og-image, /sitemap.xml, /robots.txt-mit-Logik. Bekommt das raw
   *  Hono-app + den AppContext (db/redis/registry/...) mit dem die
   *  Route gegen die Domain queryen kann. */
  readonly extraRoutes?: (
    app: import("hono").Hono,
    ctx: { db: import("@kumiko/framework/db").DbConnection; redis: import("ioredis").default },
  ) => void;
  /** When true (default), Bun.serve is started before runProdApp resolves —
   *  the common case: `await runProdApp({...})` boots the server and the
   *  process stays up listening on PORT. Set to false in tests that drive
   *  the fetch-handler directly (Bun.serve isn't available under vitest +
   *  node), then call handle.listen() manually if needed. */
  readonly autoListen?: boolean;
};

export type ProdAppHandle = {
  readonly entrypoint: ApiEntrypoint;
  /** The fetch-handler — wired into Bun.serve in production, called
   *  directly in tests. Composes Hono + static-fallback. */
  readonly fetch: (req: Request) => Promise<Response> | Response;
  /** Active Bun-server (only set when listen() was called — tests skip
   *  listen() because Bun.serve isn't available under vitest/node). */
  server?: ReturnType<typeof Bun.serve>;
  /** Bind to PORT and start serving. Production calls this; tests don't. */
  readonly listen: (port?: number) => Promise<void>;
  readonly stop: () => Promise<void>;
};

export async function runProdApp(options: RunProdAppOptions): Promise<ProdAppHandle> {
  // 1. Polyfill before anything else — feature code references Temporal.
  const { ensureTemporalPolyfill } = await import("@kumiko/framework/time");
  await ensureTemporalPolyfill();

  // 2. Env-vars: fail-fast. Better a 0s boot crash with a clear error
  //    than a 30s timeout chasing a Postgres connection that was never
  //    configured.
  const databaseUrl = requireEnv("DATABASE_URL");
  const redisUrl = requireEnv("REDIS_URL");
  const jwtSecret = requireEnv("JWT_SECRET");
  const jwtIssuer = readEnv("JWT_ISSUER");
  const instanceId = readEnv("KUMIKO_INSTANCE_ID");
  const port = options.port ?? Number.parseInt(process.env["PORT"] ?? "3000", 10);

  // biome-ignore lint/suspicious/noConsole: boot-time progress hint, no logger configured this early
  console.log(`[runProdApp] booting Kumiko stack on port ${port}…`);

  // 3. Connections — Postgres + Redis. The Redis client is shared by
  //    idempotency, event-dedup, entity-cache, rate-limit; failing to
  //    construct here surfaces the misconfig immediately.
  const { db, close: closeDb } = createDbConnection(databaseUrl);
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: null });

  // 4. Feature registry. Auth-mode auto-mixes config/user/tenant/auth-email-
  //    password — same convention as runDevApp.
  const features: FeatureDefinition[] = options.auth
    ? [
        createConfigFeature(),
        createUserFeature(),
        createTenantFeature(),
        createAuthEmailPasswordFeature(),
        ...options.features,
      ]
    : [...options.features];

  validateBoot(features);
  const registry = createRegistry(features);

  // 5. Migrations: ensure framework + feature tables exist. ensureEntityTable
  //    is a no-op if the table is already there, so re-boots are safe.
  //    Schema-drift detection (drizzle-kit migrate) is Phase-4 work.
  // biome-ignore lint/suspicious/noConsole: boot-time progress hint, no logger configured this early
  console.log("[runProdApp] ensuring tables…");
  await createEventsTable(db);
  await createArchivedStreamsTable(db);
  await createProjectionStateTable(db);
  await createEventConsumerStateTable(db);

  for (const feature of features) {
    for (const [entityName, entity] of Object.entries(feature.entities)) {
      const created = await ensureEntityTable(db, entity, entityName);
      // biome-ignore lint/suspicious/noConsole: migration-step log, visible in container stdout
      if (created) console.log(`[runProdApp]   created table for ${feature.name}:${entityName}`);
    }
  }

  // 6. Pipeline pieces — same default config as runDevApp's setupTestStack.
  const idempotency = createIdempotencyGuard(redis, { ttlSeconds: 60 });
  const eventDedup = createEventDedup(redis, { ttlSeconds: 60 });
  const entityCache = createEntityCache(redis, { ttlSeconds: 60 });

  // 7. Lifecycle is built by createApiEntrypoint when not supplied —
  //    we let the entrypoint own it and read it back through the handle
  //    for SIGTERM.
  const extraContext = options.auth
    ? { configResolver: createConfigResolver(), ...(options.extraContext ?? {}) }
    : (options.extraContext ?? {});

  const entrypoint = createApiEntrypoint({
    registry,
    context: {
      db,
      redis,
      entityCache,
      registry,
      ...extraContext,
    },
    jwtSecret,
    ...(jwtIssuer && { jwtIssuer }),
    ...(instanceId && { instanceId }),
    dispatcherOptions: { idempotency },
    eventDedup,
    ...(options.auth && {
      auth: {
        membershipQuery: TenantQueries.memberships,
        loginHandler: AuthHandlers.login,
        loginErrorStatusMap: options.auth.loginErrorStatusMap ?? {
          [AuthErrors.invalidCredentials]: 401,
          [AuthErrors.noMembership]: 403,
        },
      },
    }),
    ...(options.anonymousAccess && { anonymousAccess: options.anonymousAccess }),
  } satisfies ApiEntrypointOptions);

  // 8. Build the AppSchema once so feature-toggles / nav-config / screen-
  //    metadata is computable. Useful for debug-endpoints; harmless to
  //    pre-compute.
  void buildAppSchema(registry);

  // 9. Seeds: admin first, then app-specific. Both expected to be
  //    idempotent — runProdApp doesn't gate "first boot" via flag,
  //    seeds check their own preconditions. seedAdmin checks email,
  //    app seeds typically check "is my fixture row there?".
  if (options.auth) {
    await seedAdmin(db, options.auth.admin);
  }
  for (const seed of options.seeds ?? []) {
    await seed({ db });
  }

  await entrypoint.start();

  // 10. App-eigene HTTP-Routes mounten — vor dem static-fallback. Hono
  //     matcht in Eintrags-Reihenfolge, also greifen explizite Routen
  //     der App (z.B. /feed.xml) bevor der Static-Fallback nach Disk-
  //     Files sucht. Eingehende /api/*-Pfade sind schon vom dispatcher
  //     belegt; extraRoutes sollte die nicht überschreiben (kein
  //     enforce, das ist Author-Verantwortung).
  if (options.extraRoutes) {
    options.extraRoutes(entrypoint.app, { db, redis });
  }

  // 11. Build the fetch-handler. Static-fallback for non-/api/ paths
  //     wired via a wrapper so Hono owns /api/* + extraRoutes and disk
  //     owns the rest. Tests use this directly; listen() wraps it in
  //     Bun.serve.
  const fetchHandler = options.staticDir
    ? buildStaticFallback(entrypoint.app.fetch.bind(entrypoint.app), options.staticDir)
    : entrypoint.app.fetch.bind(entrypoint.app);

  // 11. Mark lifecycle ready — health/ready flips to 200 after this.
  entrypoint.lifecycle.markReady();

  const handle: ProdAppHandle = {
    entrypoint,
    fetch: fetchHandler,
    listen: async (listenPort = port) => {
      // Bun.serve is the production HTTP. Tests don't call listen()
      // because vitest runs under Node where Bun.serve doesn't exist.
      // idleTimeout: 0 disabled die default-10s Idle-Close — kritisch
      // für SSE: ohne das beendet Bun ungenutzte Streams nach 10s mit
      // einem halben HTTP/2-RST_STREAM, Browser sieht's als
      // ERR_HTTP2_PROTOCOL_ERROR und reconnected im Loop. Lebende SSE-
      // Connections halten sich ohnehin via Heartbeat-Frames (15s) ihre
      // eigene Aktivität, normale HTTP-Requests sind kurzlebig — der
      // Default-Schutz ist hier kontraproduktiv.
      handle.server = Bun.serve({ port: listenPort, fetch: fetchHandler, idleTimeout: 0 });

      // SIGTERM/SIGINT — graceful shutdown. Only registered when we
      // actually own a Bun-server, otherwise the test process picks up
      // signals it shouldn't respond to.
      let shuttingDown = false;
      const shutdown = async (signal: string) => {
        if (shuttingDown) return;
        shuttingDown = true;
        // biome-ignore lint/suspicious/noConsole: boot-time progress hint, no logger configured this early
        console.log(`[runProdApp] ${signal} received — draining…`);
        try {
          await handle.stop();
          // biome-ignore lint/suspicious/noConsole: boot-time progress hint, no logger configured this early
          console.log("[runProdApp] graceful shutdown complete.");
        } catch (e) {
          // biome-ignore lint/suspicious/noConsole: shutdown-time error, only path is stderr
          console.error("[runProdApp] error during shutdown:", e);
        } finally {
          process.exit(0);
        }
      };
      process.on("SIGTERM", () => void shutdown("SIGTERM"));
      process.on("SIGINT", () => void shutdown("SIGINT"));

      // biome-ignore lint/suspicious/noConsole: boot-time progress hint, no logger configured this early
      console.log(`[runProdApp] ready on http://0.0.0.0:${listenPort}`);
    },
    stop: async () => {
      await entrypoint.stop();
      handle.server?.stop();
      await closeDb();
      redis.disconnect();
    },
  };

  // 12. Auto-listen unless explicitly suppressed (tests pass autoListen:
  //     false because Bun.serve isn't available under vitest/node).
  //     Production path: `await runProdApp({...})` and the server is up.
  if (options.autoListen !== false) {
    await handle.listen();
  }

  return handle;
}

// Static-fallback: try the Hono app first, fall back to a file in
// staticDir if Hono returns 404. Keeps /api/* on the dispatcher and
// everything else (HTML, JS, CSS, images) on the disk.
//
// Cache-Header-Strategie:
//   /assets/*               → public, max-age=31536000, immutable
//                             (gehashte Filenames vom Build, sicher cachebar)
//   /index.html             → no-cache, must-revalidate
//                             (HTML-Shell, must reload on deploy)
//   /manifest.json, /sw.js  → no-cache
//                             (Update-Detection-Mechanismen, müssen frisch sein)
//   alles andere            → kein expliziter Header
//                             (Browser-Default, public/-Files wie favicon)
function buildStaticFallback(
  apiHandler: (req: Request) => Response | Promise<Response>,
  staticDir: string,
): (req: Request) => Promise<Response> {
  const indexHtml = `${staticDir}/index.html`;

  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    // /api/* and /_health → always Hono. Static-fallback only for
    // browser-facing paths.
    if (url.pathname.startsWith("/api/") || url.pathname === "/health") {
      return apiHandler(req);
    }

    // Try the static file. Default route "/" → index.html.
    const relPath = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    const filePath = `${staticDir}/${relPath}`;
    const file = Bun.file(filePath);
    if (await file.exists()) {
      return new Response(file, {
        headers: cacheHeadersFor(url.pathname),
      });
    }

    // Fallback to index.html for SPA-style routes that the Hono app
    // doesn't claim.
    const index = Bun.file(indexHtml);
    if (await index.exists()) {
      return new Response(index, {
        headers: cacheHeadersFor("/index.html"),
      });
    }

    return apiHandler(req);
  };
}

// Map URL-Pfad → Cache-Control. Hashed-Asset-Pfade (/assets/*) sind
// unveränderlich, der Rest bleibt no-cache damit Updates ohne Hard-
// Reload greifen. Exported für Unit-Tests; Konsumenten gehen via
// runProdApp.
export function cacheHeadersFor(pathname: string): HeadersInit {
  if (pathname.startsWith(`/${ASSETS_DIR}/`)) {
    return { "cache-control": "public, max-age=31536000, immutable" };
  }
  if (pathname === "/" || pathname === "/index.html") {
    return { "cache-control": "no-cache, must-revalidate" };
  }
  if (pathname === "/manifest.json" || pathname === "/sw.js") {
    return { "cache-control": "no-cache" };
  }
  return {};
}
