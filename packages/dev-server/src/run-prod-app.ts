// runProdApp — production-grade Bootstrap-Wrapper für Kumiko-Apps.
//
// Symmetrisch zu runDevApp, aber:
//   - DATABASE_URL / REDIS_URL / JWT_SECRET aus env (fail-fast bei Boot,
//     keine ephemeralen Test-DBs)
//   - Hard Schema-Drift-Gate: prüft drizzle/migrations/_journal vs.
//     __drizzle_migrations + tableExists für jede erwartete Tabelle.
//     KEIN Auto-CREATE TABLE im Boot — Migration ist ein CI-Step
//     (`yarn kumiko migrate apply`), Boot validiert nur. Verhindert
//     Race-Conditions bei Multi-Replica-Deploys + macht Schema-Stand
//     reviewbar in der Pull-Request.
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
  type EmailVerificationOptions,
  type PasswordResetOptions,
  type SignupOptions,
} from "@kumiko/bundled-features/auth-email-password";
import {
  type SeedAdminOptions,
  seedAdmin,
} from "@kumiko/bundled-features/auth-email-password/seeding";
import { createConfigResolver } from "@kumiko/bundled-features/config";
import { createSessionCallbacks } from "@kumiko/bundled-features/sessions";
import { TenantQueries } from "@kumiko/bundled-features/tenant";
import { UserQueries } from "@kumiko/bundled-features/user";
import { createSseBroker, type SseBroker } from "@kumiko/framework/api";
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
import { assertSchemaCurrent, SchemaDriftError } from "@kumiko/framework/migrations";
import {
  createEntityCache,
  createEventDedup,
  createIdempotencyGuard,
} from "@kumiko/framework/pipeline";
import Redis from "ioredis";
import { ASSETS_DIR } from "./build-prod-bundle";
import { buildComposeAuthOptions, composeFeatures } from "./compose-features";
import { injectSchema } from "./inject-schema";

/**
 * Bun.serve-Options für Production.
 *
 * Spec: idleTimeout: 0 (= disabled). SSE-Streams werden via Heartbeat
 * lebend gehalten (siehe SSE_HEARTBEAT_INTERVAL_MS in framework/api/
 * sse-route.ts), kein Bun-side Idle-Cleanup nötig. Mit dem Default
 * von 10 s killt Bun nach jedem Heartbeat-Gap die Connection mit
 * halbem HTTP/2-RST_STREAM → Browser ERR_HTTP2_PROTOCOL_ERROR.
 *
 * Spec-Test in __tests__/run-prod-app-spec.test.ts pinst die 0 gegen
 * "looks like a leak"-Reverts.
 */
export function buildBunServeOptions(
  port: number,
  fetchHandler: (req: Request) => Response | Promise<Response>,
): {
  readonly port: number;
  readonly fetch: (req: Request) => Response | Promise<Response>;
  readonly idleTimeout: number;
} {
  return { port, fetch: fetchHandler, idleTimeout: 0 };
}

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

/** Wrapper-API für den Password-Reset-Flow.
 *
 *  Setup = Feature-Options (PasswordResetOptions = hmacSecret +
 *  tokenTtlMinutes) PLUS die Mail-Side die der Wrapper an die
 *  auth-routes-config durchreicht (sendResetEmail-callback +
 *  appResetUrl). Apps geben EINEN Block; run{Prod,Dev}App splittet
 *  intern auf composeFeatures(authOptions) für die Feature-Options
 *  und auth-routes-config für die Mail-Side. extends-Beziehung
 *  pinst die Synchronität: jede Feature-Option ist auch Wrapper-Option. */
export type PasswordResetSetup = PasswordResetOptions & {
  readonly sendResetEmail: (args: {
    email: string;
    resetUrl: string;
    expiresAt: string;
  }) => Promise<void>;
  /** App-URL des ResetPasswordScreen. Framework appended `?token=…`;
   *  KEIN trailing `?` oder `#`. Beispiel: "https://admin.example.com/reset-password" */
  readonly appResetUrl: string;
};

/** Wrapper-API für den Email-Verification-Flow. Symmetrisch zu
 *  PasswordResetSetup — extends EmailVerificationOptions + Mail-Side. */
export type EmailVerificationSetup = EmailVerificationOptions & {
  readonly sendVerificationEmail: (args: {
    email: string;
    verificationUrl: string;
    expiresAt: string;
  }) => Promise<void>;
  readonly appVerifyUrl: string;
};

/** Wrapper-API für Magic-Link Self-Signup. Mirror der existing
 *  PasswordResetSetup-Struktur — Feature-Options (tokenTtlMinutes,
 *  tokenLength) plus die Mail-Side die der Wrapper an die auth-routes-
 *  config durchreicht. Anders als reset/verify gibt's KEIN hmacSecret —
 *  Signup-Tokens sind opaque random in Redis, nicht HMAC-signed. */
export type SignupSetup = SignupOptions & {
  readonly sendActivationEmail: (args: {
    email: string;
    activationUrl: string;
    expiresAt: string;
  }) => Promise<void>;
  readonly appActivationUrl: string;
};

export type RunProdAppAuthOptions = {
  /** Initial admin user. Seeded once (idempotent — re-boots check first
   *  whether the email is already in the users table). */
  readonly admin: SeedAdminOptions;
  /** Optional override of the login error → HTTP status map. */
  readonly loginErrorStatusMap?: Readonly<Record<string, number>>;
  /** Opt-in: revocable server-side sessions. Caller MUSS
   *  `createSessionsFeature()` zu `features` adden — runProdApp wired
   *  hier nur die Auth-Callbacks (creator/revoker/checker) gegen die
   *  echte db-connection, plus sessionStrictMode=true.
   *
   *  Standardverhalten ohne diese Option: stateless JWTs ohne sid
   *  (legacy-Verhalten, Karten­haus existing-Apps unangefasst). */
  readonly sessions?: {
    readonly expiresInMs?: number;
  };
  /** Password-reset flow. When set, /api/auth/request-password-reset +
   *  /api/auth/reset-password are mounted as public routes UND der
   *  request/confirm-Handler im auth-email-password-Feature wird
   *  registriert (sonst dispatchen die Routes ins Leere → 500). */
  readonly passwordReset?: PasswordResetSetup;
  /** Email-verification flow. Symmetric to passwordReset. */
  readonly emailVerification?: EmailVerificationSetup;
  /** Self-Signup flow (Magic-Link). When set, /api/auth/signup-request +
   *  /api/auth/signup-confirm are mounted; signup-confirm mintet JWT +
   *  Cookies wie ein erfolgreicher login (Auto-Login direkt nach
   *  Activation). */
  readonly signup?: SignupSetup;
};

/** Hook for app-specific seeding — runs after the admin (when auth is
 *  active). Each seed is responsible for its own idempotence (seeds are
 *  expected to check "is my row already there?" before inserting). */
export type ProdSeedFn = (deps: {
  db: import("@kumiko/framework/db").DbConnection;
}) => Promise<void>;

/** Boot-Time-Deps die `extraContext` + `anonymousAccess` Factories als
 *  Argument bekommen. Closure dann in der returned Config (z.B. ein
 *  TenantResolver der gegen `db` queriet, oder ein extraContext-Provider
 *  der direkt SSE-Events publishen will). Single-source: identisch zu
 *  setupTestStack's extraContext-Factory-Shape damit Test/Prod gleich
 *  aussehen. */
export type RunProdAppDeps = {
  readonly db: import("@kumiko/framework/db").DbConnection;
  readonly redis: import("ioredis").default;
  readonly registry: import("@kumiko/framework/engine").Registry;
  readonly sseBroker: SseBroker;
};

export type AnonymousAccessOption =
  | import("@kumiko/framework/api").ServerOptions["anonymousAccess"]
  | ((deps: RunProdAppDeps) => import("@kumiko/framework/api").ServerOptions["anonymousAccess"]);

export type ExtraContextOption =
  | Record<string, unknown>
  | ((deps: RunProdAppDeps) => Record<string, unknown>);

/** Per-Host Routing-Entscheidung für den staticDir-Fallback. Wird aus
 *  hostDispatch returned. Drei Modi:
 *    - "html": eine bestimmte HTML-Datei (relativ zu staticDir) servieren,
 *      mit optionaler Schema-Injection und CSP. Schema-Injection MUSS
 *      explizit eingeschaltet werden (default false) — Public-Domain-
 *      Antworten leaken sonst die volle Admin-UI-Schema-Topologie.
 *    - "redirect": 301/302 an die angegebene Location.
 *    - "not-found": klar abweisen (z.B. unbekannte Subdomain).
 *
 *  Wird NUR konsultiert wenn der Pfad sonst auf den HTML-Fallback gehen
 *  würde — also für "/", "/index.html", oder SPA-Routen die weder Hono
 *  matched noch eine konkrete Disk-Datei treffen. Asset-Pfade (/assets/*)
 *  und API-Pfade laufen unabhängig vom Host. */
export type HostDispatchResult =
  | {
      readonly kind: "html";
      readonly file: string;
      readonly injectSchema?: boolean;
      readonly csp?: string;
    }
  | { readonly kind: "redirect"; readonly to: string; readonly status?: 301 | 302 }
  | { readonly kind: "not-found" };

export type HostDispatchFn = (req: {
  readonly host: string;
  readonly path: string;
}) => HostDispatchResult;

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
  /** Anonymous-access for public endpoints (same shape as runDevApp).
   *  Akzeptiert entweder einen statischen Config-Object ODER eine
   *  Factory `({db, redis, registry}) => Config` — die Factory wird
   *  einmal zur Boot-Zeit aufgerufen, NACHDEM db/redis/registry konstruiert
   *  sind. Der Caller closure'd typischerweise db/redis/registry in den
   *  TenantResolver damit z.B. ein Subdomain → Tenant-Lookup gegen die
   *  DB möglich ist (siehe samples/showcases/publicstatus für das
   *  Multi-Tenant-Pattern). */
  readonly anonymousAccess?: AnonymousAccessOption;
  /** Static-file root for HTML / assets. Served on the catch-all route
   *  for any path that doesn't match an /api/ handler. Use this for the
   *  public status page HTML, embed widget JS, etc. */
  readonly staticDir?: string;
  /** Host-aware Routing-Hook für Multi-Tenant + Multi-App-Deployments
   *  (z.B. publicstatus's `<sub>.publicstatus.eu` (Public-Page) +
   *  `admin.publicstatus.eu` (Admin-UI) + `publicstatus.eu` (Apex/
   *  Marketing) im SELBEN Container).
   *
   *  Wird aufgerufen wenn der staticDir-Fallback einen HTML-Response
   *  generieren würde (Root oder SPA-Route). Default-Verhalten ohne
   *  hostDispatch: index.html mit Schema-Injection (Single-App).
   *
   *  Sicherheitshinweis: Schema-Injection (`__KUMIKO_SCHEMA__`) leakt
   *  die Admin-UI-Topologie (alle Screens, Felder, Layouts) ans HTML.
   *  Public-Domain-Antworten sollen das NIEMALS — `injectSchema` ist
   *  daher default false und MUSS pro Host explizit eingeschaltet
   *  werden. CSP-Header pro Host können zusätzlich Asset-Pfade
   *  einschränken. */
  readonly hostDispatch?: HostDispatchFn;
  /** Pfad zu drizzle/migrations für den Boot-Gate. Default "./drizzle/
   *  migrations" relativ zum process-cwd (wo die App gestartet wird —
   *  bei Container-Deploys typischerweise der App-Workspace-Root, weil
   *  WORKDIR im Dockerfile dorthin zeigt). Boot wirft SchemaDriftError
   *  wenn Migrations pending sind oder erwartete Tabellen fehlen.
   *  Setze auf `false` um den Gate komplett zu deaktivieren — nur für
   *  Setups die ihren eigenen Schema-Check fahren (z.B. bring-your-own-
   *  ORM). Standard-Apps lassen das default. */
  readonly migrations?: { readonly dir: string } | false;
  /** Extra AppContext keys. configResolver is auto-set in auth-mode.
   *  Akzeptiert entweder einen statischen Object ODER eine Factory
   *  `({db, redis, registry}) => Record<string, unknown>` — gleiches
   *  Pattern wie `anonymousAccess`. Im Auth-Mode wird `configResolver`
   *  weiterhin automatisch ergänzt; Factory-Result + auto-resolver
   *  werden gemerged (Factory-Werte überschreiben). */
  readonly extraContext?: ExtraContextOption;
  /** Job-Block. Wenn das Feature `r.job(...)` registriert, MUSS dieser
   *  Block gesetzt sein — sonst wirft createApiEntrypoint mit dem
   *  expliziten "registry declares N job(s)..."-Fehler. Default-Pattern
   *  für Single-Container-Deployments (publicstatus, kleine SaaS):
   *  `{ runLocalJobs: true }` — der API-Process consumiert auch die
   *  Worker-Lane, kein separates worker-Image nötig. Für skalierende
   *  Setups (mehrere API-Replicas + dezidierte Worker): runLocalJobs
   *  weglassen + workers via separatem `runWorkerApp` (kommt Phase 4). */
  readonly jobs?: {
    /** Default true (Single-Container). */
    readonly runLocalJobs?: boolean;
    /** BullMQ-Queue-Prefix (default "kumiko"). */
    readonly queueNamePrefix?: string;
  };
  /** Mount-Point für app-eigene HTTP-Routes außerhalb des Dispatcher-
   *  Systems. Aufgerufen NACH /api/* + /health, VOR der static-fallback —
   *  perfekt für GET-Endpoints die kein JSON liefern: /feed.xml,
   *  /og-image, /sitemap.xml, /robots.txt-mit-Logik. Bekommt das raw
   *  Hono-app + die Connection-Deps (db/redis) zum Querying.
   *
   *  Naming: `deps` statt `ctx` weil im Framework `ctx` der HandlerContext
   *  mit user/tenant/registry ist — hier ist der Scope absichtlich kleiner
   *  (Routes laufen außerhalb der Auth/Tenant-Pipeline). */
  readonly extraRoutes?: (
    app: import("hono").Hono,
    deps: { db: import("@kumiko/framework/db").DbConnection; redis: import("ioredis").default },
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
  //    password via composeFeatures — same source-of-truth as runDevApp
  //    AND the per-app drizzle-Schema-Generator, so Migration und Runtime
  //    sehen exakt dieselbe Liste.
  const composeAuthOptions = buildComposeAuthOptions(options.auth);
  const features = composeFeatures(options.features, {
    includeBundled: !!options.auth,
    ...(composeAuthOptions && { authOptions: composeAuthOptions }),
  });

  validateBoot(features);
  const registry = createRegistry(features);

  // 5. Schema-Drift-Gate. Drizzle-kit migrate (yarn kumiko migrate apply)
  //    läuft als CI-Step VOR dem Container-Rollout. Boot prüft hier nur:
  //      (a) Alle Migrations aus drizzle/migrations/meta/_journal.json
  //          sind in __drizzle_migrations applied
  //      (b) Alle erwarteten Tabellen existieren physisch
  //    Drift = Boot-Error mit klarer Meldung (kein Auto-Heal — mehrere
  //    Container-Replicas würden sonst race-conditionen beim ALTER TABLE
  //    fahren). Opt-out via `migrations: false` für custom Schema-Setups.
  if (options.migrations !== false) {
    const migrationsDir = options.migrations?.dir ?? "./drizzle/migrations";
    // biome-ignore lint/suspicious/noConsole: boot-time progress hint
    console.log(`[runProdApp] checking schema drift (${migrationsDir})…`);
    try {
      await assertSchemaCurrent(db, migrationsDir);
    } catch (err) {
      if (err instanceof SchemaDriftError) {
        // biome-ignore lint/suspicious/noConsole: terminal error message
        console.error(`\n[runProdApp] BOOT ABORTED — ${err.message}\n`);
      }
      throw err;
    }
  }

  // 6. Pipeline pieces — same default config as runDevApp's setupTestStack.
  const idempotency = createIdempotencyGuard(redis, { ttlSeconds: 60 });
  const eventDedup = createEventDedup(redis, { ttlSeconds: 60 });
  const entityCache = createEntityCache(redis, { ttlSeconds: 60 });

  // 7. Lifecycle is built by createApiEntrypoint when not supplied —
  //    we let the entrypoint own it and read it back through the handle
  //    for SIGTERM.
  //
  // extraContext + anonymousAccess sind factory-union: entweder direktes
  // Object oder Function die {db, redis, registry} bekommt und das Object
  // returned. Factory-Form gilt als bevorzugt für Cases die zur Boot-Zeit
  // gegen die DB resolven müssen (z.B. Subdomain-Tenant-Lookup im
  // tenantResolver) — die Factory closure'd `db` und der Resolver kann
  // sie zur Request-Zeit aufrufen.
  // sseBroker hier bauen (statt's createApiEntrypoint intern machen zu
  // lassen) damit extraContext-Factories ihn schon zur Boot-Zeit closure'n
  // können — z.B. ein extraContext-Provider der direkt SSE-Events
  // publisht. Wir reichen denselben Broker dann an createApiEntrypoint
  // durch (sseBroker?-option), damit der Server-internal-Broadcast und
  // App-spezifische Publishes über genau einen Broker laufen.
  const sseBroker = createSseBroker();
  const deps: RunProdAppDeps = { db, redis, registry, sseBroker };
  const resolvedExtraContext =
    typeof options.extraContext === "function"
      ? options.extraContext(deps)
      : (options.extraContext ?? {});
  const extraContext = options.auth
    ? { configResolver: createConfigResolver(), ...resolvedExtraContext }
    : resolvedExtraContext;
  const resolvedAnonymousAccess =
    typeof options.anonymousAccess === "function"
      ? options.anonymousAccess(deps)
      : options.anonymousAccess;

  // Sessions opt-in: db ist hier schon konkret (createDbConnection oben),
  // also direkt verdrahten — kein late-bound nötig wie bei runDevApp.
  // sessionStrictMode=true: Prod-Sessions sollen nicht stillschweigend
  // von einem JWT-ohne-sid umgangen werden können. sessionMassRevoker
  // (4. callback aus createSessionCallbacks) ist nicht Teil der
  // AuthRoutesConfig-Surface — der wird vom sessions-Feature selbst über
  // die `autoRevokeOnPasswordChange`-Option konsumiert, nicht über die
  // auth-routes.
  const sessionAuthFragment = options.auth?.sessions
    ? buildProdSessionAuth(db, options.auth.sessions)
    : undefined;

  const entrypoint = createApiEntrypoint({
    registry,
    context: {
      db,
      redis,
      entityCache,
      registry,
      ...extraContext,
    },
    sseBroker,
    jwtSecret,
    ...(jwtIssuer && { jwtIssuer }),
    ...(instanceId && { instanceId }),
    dispatcherOptions: { idempotency },
    eventDedup,
    ...(options.auth && {
      auth: {
        membershipQuery: TenantQueries.memberships,
        userQuery: UserQueries.findForAuth,
        loginHandler: AuthHandlers.login,
        loginErrorStatusMap: options.auth.loginErrorStatusMap ?? {
          [AuthErrors.invalidCredentials]: 401,
          [AuthErrors.noMembership]: 403,
        },
        ...sessionAuthFragment,
        ...(options.auth.passwordReset && {
          passwordReset: {
            requestHandler: AuthHandlers.requestPasswordReset,
            confirmHandler: AuthHandlers.resetPassword,
            sendResetEmail: options.auth.passwordReset.sendResetEmail,
            appResetUrl: options.auth.passwordReset.appResetUrl,
          },
        }),
        ...(options.auth.emailVerification && {
          emailVerification: {
            requestHandler: AuthHandlers.requestEmailVerification,
            confirmHandler: AuthHandlers.verifyEmail,
            sendVerificationEmail: options.auth.emailVerification.sendVerificationEmail,
            appVerifyUrl: options.auth.emailVerification.appVerifyUrl,
          },
        }),
        ...(options.auth.signup && {
          signup: {
            requestHandler: AuthHandlers.signupRequest,
            confirmHandler: AuthHandlers.signupConfirm,
            sendActivationEmail: options.auth.signup.sendActivationEmail,
            appActivationUrl: options.auth.signup.appActivationUrl,
          },
        }),
      },
    }),
    ...(resolvedAnonymousAccess && { anonymousAccess: resolvedAnonymousAccess }),
    // Auto-Pass-Through für r.job-Wiring: wenn das Registry Jobs
    // deklariert, MUSS der jobs-Block gesetzt sein — sonst stoppt
    // createApiEntrypoint mit explizitem Fehler. Default für Single-
    // Container-Deployments: runLocalJobs=true (API-Process consumiert
    // auch worker-Lane). Caller kann override'n via options.jobs.
    ...(registry.getAllJobs().size > 0 && {
      jobs: {
        redisUrl,
        runLocalJobs: options.jobs?.runLocalJobs ?? true,
        ...(options.jobs?.queueNamePrefix !== undefined && {
          queueNamePrefix: options.jobs.queueNamePrefix,
        }),
      },
    }),
  } satisfies ApiEntrypointOptions);

  // 8. Build the AppSchema once + serialize. Wird beim Static-Fallback
  //    in die index.html injiziert damit createKumikoApp() im Browser
  //    `window.__KUMIKO_SCHEMA__` synchron lesen kann — gleicher Pfad
  //    wie im dev-server, damit der Client-Code keine Sonderfall-
  //    Branch zwischen dev/prod braucht. Boot-once weil Features
  //    nach dem Start nicht mehr ändern.
  // TODO: Sobald per-Tenant- oder per-User-Schema kommt (Feature-Toggles
  // pro Tenant, Auth-Rolle gated Screens), muss die Injection pro
  // Request rendern — staticDir-Fallback einen render(req)-Hook bekommen
  // statt eines fixed JSON-Strings. Heute: registry-static, also OK.
  const appSchemaJson = JSON.stringify(buildAppSchema(registry));

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
    ? buildStaticFallback(
        entrypoint.app.fetch.bind(entrypoint.app),
        options.staticDir,
        appSchemaJson,
        options.hostDispatch,
      )
    : entrypoint.app.fetch.bind(entrypoint.app);

  // 11. Mark lifecycle ready — health/ready flips to 200 after this.
  entrypoint.lifecycle.markReady();

  const handle: ProdAppHandle = {
    entrypoint,
    fetch: fetchHandler,
    listen: async (listenPort = port) => {
      // Bun.serve is the production HTTP. Tests don't call listen()
      // because vitest runs under Node where Bun.serve doesn't exist.
      // Options-Shape (inkl. idleTimeout: 0 für SSE) liegt in der
      // exportierten buildBunServeOptions-Funktion — siehe ihren
      // Header für die Begründung.
      if (typeof (globalThis as { Bun?: unknown }).Bun === "undefined") {
        // Klare Fehlermeldung statt nackter ReferenceError. Trifft wenn
        // jemand listen() unter Node/vitest aufruft ohne autoListen:false
        // — hilft beim Debug, statt sich an "Bun is not defined" abzumühen.
        throw new Error(
          "[runProdApp] listen() requires Bun runtime (Bun.serve). " +
            "Under Node/vitest pass `autoListen: false` and call the returned `fetch()` directly.",
        );
      }
      handle.server = Bun.serve(buildBunServeOptions(listenPort, fetchHandler));

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
// File-reader für den static-fallback. Nutzt node:fs/promises statt
// Bun.file damit der Pfad in vitest+node integration-tests laufen kann
// (Bun.file ist Bun-only). Performance-cost ist marginal: die Disk-
// Files in einem prod-staticDir sind 1-200 KB, full-buffer-Read ist
// ein paar Mikrosekunden. Streaming via Bun.file wäre nur relevant ab
// ~1 MB.
async function readStaticFile(
  filePath: string,
): Promise<{ readonly bytes: Uint8Array; readonly mime: string } | undefined> {
  try {
    const { readFile } = await import("node:fs/promises");
    const bytes = await readFile(filePath);
    return { bytes, mime: mimeTypeFor(filePath) };
  } catch (err) {
    if ((err as { code?: string }).code === "ENOENT") return undefined;
    throw err;
  }
}

// Minimal-Mime-Map — deckt die Files ab die kumiko-build und typische
// public/-Inhalte produzieren. Bun.file leitet das aus dem Suffix ab,
// im node-Pfad müssen wir es selbst tun. Default: octet-stream (Browser
// fragt bei unbekanntem MIME nach).
function mimeTypeFor(filePath: string): string {
  const ext = filePath.toLowerCase().split(".").pop() ?? "";
  switch (ext) {
    case "html":
      return "text/html; charset=utf-8";
    case "js":
    case "mjs":
      return "text/javascript; charset=utf-8";
    case "css":
      return "text/css; charset=utf-8";
    case "json":
      return "application/json; charset=utf-8";
    case "svg":
      return "image/svg+xml";
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "ico":
      return "image/x-icon";
    case "txt":
      return "text/plain; charset=utf-8";
    case "xml":
      return "application/xml; charset=utf-8";
    case "webmanifest":
      return "application/manifest+json";
    default:
      return "application/octet-stream";
  }
}

function buildStaticFallback(
  apiHandler: (req: Request) => Response | Promise<Response>,
  staticDir: string,
  appSchemaJson: string,
  hostDispatch?: HostDispatchFn,
): (req: Request) => Promise<Response> {
  const indexHtml = `${staticDir}/index.html`;

  // Helper: liest eine HTML-Datei von der Disk + (optional) injiziert
  // das pre-serialized AppSchema vor dem client.js-Tag. Schema-Injection
  // ist explicit-opt-in damit Public-Domain-Antworten die Admin-UI-
  // Topologie nicht leaken. injectSchema ist idempotent, doppelte Calls
  // produzieren keinen doppelten Tag.
  async function readHtmlFile(
    path: string,
    injectSchemaInto: boolean,
  ): Promise<{ bytes: ArrayBuffer; mime: string } | null> {
    const file = await readStaticFile(path);
    if (!file) return null;
    if (!injectSchemaInto) {
      return {
        bytes: file.bytes.buffer.slice(
          file.bytes.byteOffset,
          file.bytes.byteOffset + file.bytes.byteLength,
        ) as ArrayBuffer,
        mime: file.mime,
      };
    }
    const text = new TextDecoder().decode(file.bytes);
    const injected = injectSchema(text, appSchemaJson);
    return { bytes: new TextEncoder().encode(injected).buffer as ArrayBuffer, mime: file.mime };
  }

  // hostDispatch konsultieren wenn gesetzt UND der Request auf den
  // HTML-Fallback fällt (Root oder SPA-Route). Returnt entweder die
  // resolved Response (redirect/404/html) oder null wenn der Default-
  // Pfad weiterlaufen soll.
  async function tryHostDispatch(req: Request): Promise<Response | null> {
    if (!hostDispatch) return null;
    const url = new URL(req.url);
    const host = req.headers.get("host") ?? url.host;
    const result = hostDispatch({ host, path: url.pathname });
    if (result.kind === "not-found") {
      return new Response("Not Found", { status: 404 });
    }
    if (result.kind === "redirect") {
      return new Response(null, {
        status: result.status ?? 302,
        headers: { Location: result.to },
      });
    }
    // result.kind === "html"
    const filePath = `${staticDir}/${result.file}`;
    const html = await readHtmlFile(filePath, result.injectSchema === true);
    if (!html) {
      // Author-Fehler: hostDispatch verweist auf nicht-existente Datei.
      // Liefer 500 statt silent-404 damit der Bug schnell auffällt.
      return new Response(`hostDispatch: file not found: ${result.file}`, { status: 500 });
    }
    const headers: Record<string, string> = {
      ...cacheHeadersFor("/index.html"),
      "content-type": html.mime,
    };
    if (result.csp) headers["content-security-policy"] = result.csp;
    return new Response(html.bytes, { headers });
  }

  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    // /api/* and /health → always Hono (Dispatcher + Health-Probe).
    if (url.pathname.startsWith("/api/") || url.pathname === "/health") {
      return apiHandler(req);
    }

    // Hono-First für andere Pfade: extraRoutes (z.B. /feed.xml,
    // /sitemap.xml) müssen vor dem Disk-Lookup greifen, sonst
    // schluckt der SPA-Fallback unten unbekannte Pfade als index.html.
    const honoRes = await apiHandler(req);
    if (honoRes.status !== 404) {
      return honoRes;
    }

    // Disk-Datei (Asset oder konkrete File). Asset-Pfade laufen
    // host-unabhängig — die Bundles in /assets/* werden vom client
    // aktiv geladen, kein Server-side Routing nötig.
    const isIndexRequest = url.pathname === "/" || url.pathname === "/index.html";
    if (!isIndexRequest) {
      const relPath = url.pathname.slice(1);
      const filePath = `${staticDir}/${relPath}`;
      const file = await readStaticFile(filePath);
      if (file) {
        // @cast-boundary bun-types — Response BodyInit narrowing
        return new Response(file.bytes as unknown as BodyInit, {
          headers: { ...cacheHeadersFor(url.pathname), "content-type": file.mime },
        });
      }
    }

    // Root oder SPA-Route — hier greift hostDispatch wenn gesetzt.
    // Ohne hostDispatch: alter Single-App-Pfad (index.html mit Schema).
    const dispatched = await tryHostDispatch(req);
    if (dispatched) return dispatched;

    // Default Single-App-Pfad: index.html, schema injected.
    const index = await readHtmlFile(indexHtml, true);
    if (index) {
      return new Response(index.bytes, {
        headers: { ...cacheHeadersFor("/index.html"), "content-type": index.mime },
      });
    }

    // Kein Hono-Match, keine Disk-Datei, kein index.html → liefer den
    // ursprünglichen 404 von Hono durch (statt einen neuen Roundtrip).
    return honoRes;
  };
}

// Map URL-Pfad → Cache-Control. Hashed-Asset-Pfade (/assets/*) sind
// unveränderlich, der Rest bleibt no-cache damit Updates ohne Hard-
// Reload greifen. Exported für Unit-Tests; Konsumenten gehen via
// runProdApp.
export function cacheHeadersFor(pathname: string): Record<string, string> {
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

function buildProdSessionAuth(
  db: import("@kumiko/framework/db").DbConnection,
  opts: NonNullable<RunProdAppAuthOptions["sessions"]>,
): {
  readonly sessionCreator: ReturnType<typeof createSessionCallbacks>["sessionCreator"];
  readonly sessionRevoker: ReturnType<typeof createSessionCallbacks>["sessionRevoker"];
  readonly sessionChecker: ReturnType<typeof createSessionCallbacks>["sessionChecker"];
  readonly sessionStrictMode: true;
} {
  const cbs = createSessionCallbacks({
    db,
    ...(opts.expiresInMs !== undefined && { expiresInMs: opts.expiresInMs }),
  });
  return {
    sessionCreator: cbs.sessionCreator,
    sessionRevoker: cbs.sessionRevoker,
    sessionChecker: cbs.sessionChecker,
    sessionStrictMode: true,
  };
}
