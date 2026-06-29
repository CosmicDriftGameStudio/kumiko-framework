// runProdApp — production-grade Bootstrap-Wrapper für Kumiko-Apps.
//
// Symmetrisch zu runDevApp, aber:
//   - DATABASE_URL / REDIS_URL / JWT_SECRET aus env (fail-fast bei Boot,
//     keine ephemeralen Test-DBs)
//   - Hard Schema-Drift-Gate: prüft kumiko/migrations vs. _kumiko_migrations
//     + tableExists für jede erwartete Tabelle. KEIN Auto-CREATE TABLE im
//     Boot — Migration ist ein CI-Step (`bun kumiko schema apply`), Boot
//     validiert nur. Verhindert Race-Conditions bei Multi-Replica-Deploys
//     + macht Schema-Stand reviewbar in der Pull-Request.
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
  type InviteOptions,
  type PasswordResetOptions,
  type SignupOptions,
} from "@cosmicdrift/kumiko-bundled-features/auth-email-password";
import {
  type SeedAdminOptions,
  seedAdmin,
} from "@cosmicdrift/kumiko-bundled-features/auth-email-password/seeding";
import {
  buildEnvConfigOverrides,
  createConfigAccessorFactory,
  createConfigResolver,
} from "@cosmicdrift/kumiko-bundled-features/config";
import {
  createSessionCallbacks,
  SESSIONS_FEATURE,
} from "@cosmicdrift/kumiko-bundled-features/sessions";
import { TenantQueries } from "@cosmicdrift/kumiko-bundled-features/tenant";
import { UserQueries } from "@cosmicdrift/kumiko-bundled-features/user";
import {
  type CachePolicy,
  cachedResponse,
  computeStrongEtag,
  computeWeakEtag,
  createSseBroker,
  type SseBroker,
} from "@cosmicdrift/kumiko-framework/api";
import { createDbConnection, type DbRunner } from "@cosmicdrift/kumiko-framework/db";
import {
  buildAppSchema,
  type ConfigResolver,
  collectWriteHandlerQns,
  createRegistry,
  type EffectiveFeaturesResolver,
  type FeatureDefinition,
  findTierResolverUsage,
  type Registry,
  type TenantId,
  type TierResolverPlugin,
  validateAppCustomScreenWriteQns,
  validateBoot,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  type AllInOneEntrypoint,
  type ApiEntrypoint,
  createAllInOneEntrypoint,
  createApiEntrypoint,
} from "@cosmicdrift/kumiko-framework/entrypoint";
import {
  type ComposedEnvSchema,
  KumikoBootError,
  parseEnv,
} from "@cosmicdrift/kumiko-framework/env";
import { type DryRunMode, renderDryRun } from "@cosmicdrift/kumiko-framework/env/dry-run";
import {
  createEsOperationsTable,
  createSeedMigrationContext,
  runPendingSeedMigrations,
} from "@cosmicdrift/kumiko-framework/es-ops";
import {
  assertKumikoSchemaCurrent,
  SchemaDriftError,
} from "@cosmicdrift/kumiko-framework/migrations";
import {
  createDispatcher,
  createEntityCache,
  createEventDedup,
  createIdempotencyGuard,
} from "@cosmicdrift/kumiko-framework/pipeline";
import { warnIfNonUtcServerTimeZone } from "@cosmicdrift/kumiko-framework/time";
import Redis from "ioredis";
import { applyBootSeeds } from "./boot/apply-boot-seeds";
import { ASSETS_DIR } from "./build-prod-bundle";
import { buildComposeAuthOptions, composeFeatures } from "./compose-features";
import { type ExtraRoutesSystemDeps, makeDispatchSystemWrite } from "./extra-routes-deps";
import { injectSchema } from "./inject-schema";
import {
  type ProdSessionsConfig,
  type ProdSessionsOption,
  resolveProdSessionsConfig,
  shouldWireProdSessions,
} from "./session-wiring";
import { tryHonoFirst } from "./try-hono-first";

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
// `src` defaults to process.env but is threaded from the caller's envSource
// so the boot-path reads the SAME env-quelle that was validated above —
// injected dummies in test-mode must not silently fall back to process.env.
function requireEnv(name: string, src: Record<string, string | undefined> = process.env): string {
  const value = src[name];
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
function readEnv(
  name: string,
  src: Record<string, string | undefined> = process.env,
): string | undefined {
  const value = src[name];
  return value === undefined || value === "" ? undefined : value;
}

// `boot` is the C1 smoke-test path — validators run, no DB/Redis connect,
// exit after registry-build. Render-modes (human|json|pulumi|k8s|1)
// inspect the env-schema and exit before any feature wiring.
type RunMode = DryRunMode | "boot";

function parseRunMode(raw: string | undefined): RunMode | null {
  if (!raw) return null;
  const v = raw.toLowerCase();
  if (v === "1" || v === "true" || v === "human") return "human";
  if (v === "json" || v === "pulumi" || v === "k8s" || v === "boot") return v;
  // biome-ignore lint/suspicious/noConsole: boot-time warn for typo discovery
  console.warn(
    `[runProdApp] KUMIKO_DRY_RUN_ENV="${raw}" unrecognized ` +
      `(expected 1|human|json|pulumi|k8s|boot); continuing with normal boot.`,
  );
  return null;
}

function isRenderMode(mode: RunMode | null): mode is DryRunMode {
  return mode !== null && mode !== "boot";
}

function defaultBootErrorReporter(err: KumikoBootError): never {
  // biome-ignore lint/suspicious/noConsole: boot-time error, no logger configured yet
  console.error(err.format());
  process.exit(1);
}

// Returned from runProdApp when KUMIKO_DRY_RUN_ENV is set AND envSource
// was passed (= test-mode). The handle is intentionally inert — listen()
// and stop() are no-ops; tests inspect the dry-run console output and
// move on.
function makeDryRunHandle(): ProdAppHandle {
  const noop = async () => {
    /* dry-run handle: no server was constructed */
  };
  return {
    // @cast-boundary dry-run-mode: no ApiEntrypoint exists because no
    // boot ran; the handle only surfaces test/CLI inspection and the
    // entrypoint is never reached by callers in dry-run.
    entrypoint: undefined as unknown as ApiEntrypoint,
    fetch: () => new Response("dry-run", { status: 503 }),
    listen: noop,
    stop: noop,
  };
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

/** Wrapper-API für Tenant-Invite Magic-Link. Drei accept-Branches im
 *  framework, der Wrapper reicht NUR die Mail-Side + appAcceptUrl
 *  durch — handler-names sind hardcoded in run-prod-app aus
 *  AuthHandlers (analog signup). */
export type InviteSetup = InviteOptions & {
  readonly sendInviteEmail: (args: {
    email: string;
    inviteUrl: string;
    expiresAt: string;
    role: string;
  }) => Promise<void>;
  readonly appAcceptUrl: string;
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
  readonly sessions?: ProdSessionsOption;
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
  /** Tenant-Invite flow (Magic-Link). When set, /api/auth/invite-accept,
   *  /api/auth/invite-accept-with-login, /api/auth/invite-signup-complete
   *  are mounted. */
  readonly invite?: InviteSetup;
  /** Domain attribute for both auth cookies (see
   *  AuthRoutesConfig.cookieDomain). Set to the registrable parent
   *  domain when login and app live on different subdomains. */
  readonly cookieDomain?: string;
  /** Server-side Origin allowlist for the CSRF guard (see
   *  AuthRoutesConfig.allowedOrigins). REQUIRED once `cookieDomain` is set —
   *  buildServer fails closed otherwise. Apex + admin host, never tenant
   *  subdomains. */
  readonly allowedOrigins?: readonly string[];
  /** Opt out of the Origin guard (see AuthRoutesConfig.unsafeSkipOriginCheck)
   *  — accept the wide-cookie CSRF risk explicitly instead of setting
   *  `allowedOrigins`. */
  readonly unsafeSkipOriginCheck?: boolean;
};

/** Hook for app-specific seeding — runs after the admin (when auth is
 *  active). Each seed is responsible for its own idempotence (seeds are
 *  expected to check "is my row already there?" before inserting). */
export type ProdSeedFn = (deps: {
  db: import("@cosmicdrift/kumiko-framework/db").DbConnection;
}) => Promise<void>;

/** Boot-Time-Deps die `extraContext` + `anonymousAccess` Factories als
 *  Argument bekommen. Closure dann in der returned Config (z.B. ein
 *  TenantResolver der gegen `db` queriet, oder ein extraContext-Provider
 *  der direkt SSE-Events publishen will). Single-source: identisch zu
 *  setupTestStack's extraContext-Factory-Shape damit Test/Prod gleich
 *  aussehen. */
export type RunProdAppDeps = {
  readonly db: import("@cosmicdrift/kumiko-framework/db").DbConnection;
  readonly redis: import("ioredis").default;
  readonly registry: import("@cosmicdrift/kumiko-framework/engine").Registry;
  readonly sseBroker: SseBroker;
};

export type AnonymousAccessOption =
  | import("@cosmicdrift/kumiko-framework/api").ServerOptions["anonymousAccess"]
  | ((
      deps: RunProdAppDeps,
    ) => import("@cosmicdrift/kumiko-framework/api").ServerOptions["anonymousAccess"]);

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
  /** Query-String inkl. führendem `?`, `""` wenn keiner. Redirects die
   *  den Pfad auf einen anderen Host umbiegen (z.B. Auth-Routen mit
   *  `?token=` aus alten Mail-Links) MÜSSEN ihn an `to` anhängen. */
  readonly search: string;
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
  /** Pfad zum seeds-Directory für ES-Operations / Seed-Migrations
   *  (file-basiert wie drizzle-migrate). Wenn gesetzt + KUMIKO_SKIP_ES_OPS
   *  != "1": runProdApp scannt das Verzeichnis nach `<id>.ts` Files,
   *  diff vs kumiko_es_operations-Table, läuft pending in Tx.
   *  Plan: kumiko-platform/docs/plans/features/es-ops.md */
  readonly seedsDir?: string;
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
  /** Pfad zu kumiko/migrations für den Boot-Gate. Default "./kumiko/
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
  /** Deploy-Topologie. Default `true` (Single-Container): dieser Prozess
   *  fährt HTTP + BEIDE Job-Lanes (api + worker) + den Event-Dispatcher
   *  (MSP-Anwendung) inline — via `createAllInOneEntrypoint`. Damit laufen
   *  worker-Lane-Crons (z.B. der Daten-Export `run-export-jobs`, default
   *  `runIn:"worker"`) und r.multiStreamProjection ohne separaten Worker.
   *
   *  `false` NUR mit einem dezidierten Worker-Deployment setzen: dann fährt
   *  dieser Prozess API-only (`createApiEntrypoint`), und worker-Lane-Jobs
   *  + MSPs werden NICHT mehr lokal angewandt — der Worker muss sie
   *  übernehmen, sonst bleiben Export-Jobs pending und die Read-Side leer
   *  (2026-06-11-Incident-Klasse). */
  readonly runSingleInstance?: boolean;
  /** Job-Block. Wenn das Feature `r.job(...)` registriert, wird er
   *  automatisch verdrahtet (siehe runSingleInstance). */
  readonly jobs?: {
    /** BullMQ-Queue-Prefix (default "kumiko"). */
    readonly queueNamePrefix?: string;
  };
  /** Event-Dispatcher (MSP-Anwendung) im API-Process. Default AN —
   *  runProdApp ist das Single-Container-Deployment, es gibt keinen
   *  Worker-Process der multiStreamProjections anwenden könnte. Bis
   *  2026-06-11 fehlte der Dispatcher hier komplett: jede MSP-basierte
   *  Read-Projektion (z.B. custom-fields jsonb) blieb in Prod leer,
   *  kumiko_event_consumers blieb ohne Rows. `disabled: true` nur für
   *  Setups mit dezidiertem Worker-Process. */
  readonly eventDispatcher?: {
    readonly disabled?: boolean;
    /** Poll-Intervall des Dispatcher-Loops (default siehe
     *  createEventDispatcher). LISTEN/NOTIFY-Wiring kommt mit einem
     *  späteren pgClient-Pass-through. */
    readonly pollIntervalMs?: number;
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
  readonly extraRoutes?: (app: import("hono").Hono, deps: ExtraRoutesSystemDeps) => void;
  /** When true (default), Bun.serve is started before runProdApp resolves —
   *  the common case: `await runProdApp({...})` boots the server and the
   *  process stays up listening on PORT. Set to false in tests that drive
   *  the fetch-handler directly (Bun.serve isn't available under vitest +
   *  node), then call handle.listen() manually if needed. */
  readonly autoListen?: boolean;
  /** Feature-toggle resolver — durchgereicht an createApiEntrypoint's
   *  dispatcherOptions. Sprint-8 Tier-Composition: per-Tenant unterschied-
   *  liche features aktiv via globalFeatureToggleRuntime. Pattern:
   *  createLateBoundHolder + post-boot runtime.initialize in einem
   *  seed-fn (db ist erst nach migrations + features ready). */
  readonly effectiveFeatures?: (tenantId: TenantId) => ReadonlySet<string>;
  /** Composed Zod-schema for env-validation (from `composeEnvSchema({
   *  features, extend })` in @cosmicdrift/kumiko-framework/env). When set:
   *  - `process.env` is parsed against it BEFORE any boot work; missing
   *    or invalid vars throw a `KumikoBootError` listing ALL problems
   *    at once (not first-fail).
   *  - `KUMIKO_DRY_RUN_ENV=human|json|pulumi|k8s` introspects the schema
   *    and prints the env-var inventory, then exits without booting.
   *
   *  9.1 is additive: features that still read `process.env` directly
   *  keep working. Migration to the schema is Sprint-9.2-9.5. */
  readonly envSchema?: ComposedEnvSchema;
  /** Prefix for `pulumi config set <prefix><CamelCase(VAR)>` in dry-run
   *  output and boot-error suggestions. Without this, suggestions use
   *  bare `camelCase(VAR)` and ops has to guess the app prefix. */
  readonly pulumiPrefix?: string;
  /** Handler for KumikoBootError. Default: print formatted error to
   *  stderr and `process.exit(1)` so the container restarts with a
   *  visible log line. Override in tests that drive runProdApp directly
   *  (avoid the exit). Return type is `void` rather than `never` to keep
   *  test-overrides honest — if a reporter returns, runProdApp falls
   *  through to a regular `throw err` as the safety net. */
  readonly bootErrorReporter?: (err: KumikoBootError) => void;
  /** Override `process.env` for env-validation. Default: `process.env`.
   *  Tests use this to feed crafted env-maps without polluting the
   *  global. */
  readonly envSource?: Record<string, string | undefined>;
};

export type ProdAppHandle = {
  /** The composed entrypoint — AllInOne (runSingleInstance, default) or
   *  Api-only (runSingleInstance:false). In KUMIKO_DRY_RUN_ENV mode WITH
   *  `envSource` injected (test path), no boot ran and this slot is an
   *  undefined-cast — do not access. Production dry-run hits
   *  `process.exit(0)` before returning a handle. */
  readonly entrypoint: ApiEntrypoint | AllInOneEntrypoint;
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

// Mint `ctx.config` per request: the dispatcher only builds a per-user
// ConfigAccessor when `_configAccessorFactory` is on the AppContext
// (pipeline/dispatcher.ts). Without it `ctx.config` stays undefined and any
// handler reading it — e.g. createFileProviderForTenant for the GDPR export
// download — throws "ctx.config is missing". Built from the EFFECTIVE resolver
// so an app-supplied configResolver override (its appOverrides) is the one
// ctx.config reads. Shared with runDevApp (mergeConfigResolverDefault) for
// dev/prod parity.
export function addConfigAccessorFactory<T extends { readonly configResolver?: ConfigResolver }>(
  resolved: T,
  registry: Registry,
): T {
  if (!resolved.configResolver) return resolved;
  return {
    ...resolved,
    _configAccessorFactory: createConfigAccessorFactory(registry, resolved.configResolver),
  };
}

export async function runProdApp(options: RunProdAppOptions): Promise<ProdAppHandle> {
  // 0. Env-Schema validation + dry-run modes. Runs FIRST so:
  //    - operators can introspect env-requirements without a real boot
  //      (no DB connection needed, KUMIKO_DRY_RUN_ENV=… → render + exit)
  //    - missing/invalid env-vars produce a structured KumikoBootError
  //      with ALL problems aggregated (not first-fail), before we waste
  //      seconds on a Postgres connection that was never configured.
  //
  //    Both code paths are no-ops when no envSchema is passed — Sprint-9
  //    migration is per-feature additive; pre-migration apps keep the
  //    legacy `requireEnv("DATABASE_URL")` checks below.
  //
  //    Ordering invariant: this step runs BEFORE the Temporal polyfill,
  //    so env-schemas MUST use only Temporal-free Zod types. Don't author
  //    `z.iso.date()`/`Temporal.Instant` fields on env-vars — they'd crash
  //    at parse-time before the polyfill loads. Plain strings + .regex /
  //    .min / .email / .url cover every env-var shape we've actually
  //    needed in 9.1's audit (37 references, 25 distinct vars).
  const envSource = options.envSource ?? process.env;
  const runMode = parseRunMode(envSource["KUMIKO_DRY_RUN_ENV"]);
  if (options.envSchema) {
    if (isRenderMode(runMode)) {
      // biome-ignore lint/suspicious/noConsole: dry-run output IS the deliverable
      console.log(
        renderDryRun(options.envSchema, runMode, {
          ...(options.pulumiPrefix ? { pulumiPrefix: options.pulumiPrefix } : {}),
          sources: options.envSchema.sources,
        }),
      );
      // Tests inject envSource and want a return-value, not exit. Detecting
      // "this is a test" via envSource is brittle; instead exit when running
      // against the real process.env (the deploy-flow), return otherwise.
      if (options.envSource === undefined) {
        process.exit(0);
      }
      return makeDryRunHandle();
    }
    // boot-mode AND normal-boot both run env-validation. boot-mode wants
    // a real env-check (all required vars present + schema-valid) before
    // it asserts feature-wiring works.
    try {
      parseEnv(options.envSchema.schema, envSource, {
        sources: options.envSchema.sources,
        ...(options.pulumiPrefix ? { pulumiPrefix: options.pulumiPrefix } : {}),
      });
    } catch (err) {
      if (err instanceof KumikoBootError) {
        const reporter = options.bootErrorReporter ?? defaultBootErrorReporter;
        reporter(err);
      }
      throw err;
    }
  }

  // 1. Polyfill before anything else — feature code references Temporal.
  const { ensureTemporalPolyfill } = await import("@cosmicdrift/kumiko-framework/time");
  await ensureTemporalPolyfill();

  // 2. Env-vars: fail-fast. Better a 0s boot crash with a clear error
  //    than a 30s timeout chasing a Postgres connection that was never
  //    configured.
  const databaseUrl = requireEnv("DATABASE_URL", envSource);
  const redisUrl = requireEnv("REDIS_URL", envSource);
  const jwtSecret = requireEnv("JWT_SECRET", envSource);
  const jwtIssuer = readEnv("JWT_ISSUER", envSource);
  const instanceId = readEnv("KUMIKO_INSTANCE_ID", envSource);
  const port = options.port ?? Number.parseInt(envSource["PORT"] ?? "3000", 10);

  // biome-ignore lint/suspicious/noConsole: boot-time progress hint, no logger configured this early
  console.log(`[runProdApp] booting Kumiko stack on port ${port}…`);

  // 3. Feature registry. Auth-mode auto-mixes config/user/tenant/auth-email-
  //    password via composeFeatures — same source-of-truth as runDevApp
  //    AND the per-app drizzle-Schema-Generator, so Migration und Runtime
  //    sehen exakt dieselbe Liste. Built BEFORE any connection so boot-mode
  //    can validate wiring and exit without opening a Postgres/Redis socket.
  const composeAuthOptions = buildComposeAuthOptions(options.auth);
  const features = composeFeatures(options.features, {
    includeBundled: !!options.auth,
    ...(composeAuthOptions && { authOptions: composeAuthOptions }),
  });

  validateBoot(features);
  warnIfNonUtcServerTimeZone();
  validateAppCustomScreenWriteQns(process.cwd(), collectWriteHandlerQns(features));
  const registry = createRegistry(features);

  // C1 boot-mode exit: validators ran + registry built; no DB/Redis client
  // is constructed at all in this branch (the eager `new Redis(...)` below
  // would otherwise open a TCP connect just to immediately disconnect it).
  if (runMode === "boot") {
    // biome-ignore lint/suspicious/noConsole: boot-mode output IS the deliverable
    console.log(
      `[runProdApp] boot validation OK (${features.length} features, ${registry.features.size} registry entries)`,
    );
    if (options.envSource === undefined) {
      process.exit(0);
    }
    return makeDryRunHandle();
  }

  // 4. Connections — Postgres + Redis. The Redis client is shared by
  //    idempotency, event-dedup, entity-cache, rate-limit; failing to
  //    construct here surfaces the misconfig immediately. `new Redis(...)`
  //    connects eagerly, so it must stay AFTER the boot-mode exit above.
  const { db, close: closeDb } = createDbConnection(databaseUrl);
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: null });

  // Sprint-8a Tier-Composition auto-wire: scan features for a
  // tenantTierResolver-extension. If found AND user didn't supply own
  // effectiveFeatures, build the resolver here (db + registry are
  // available) before the dispatcher is constructed. App-Author sees
  // nothing — `createTierEngineFeature(opts)` mounts + framework auto-wires.
  let resolvedEffectiveFeatures: EffectiveFeaturesResolver | undefined = options.effectiveFeatures;
  if (resolvedEffectiveFeatures === undefined) {
    const tierResolverUsage = findTierResolverUsage(features);
    if (tierResolverUsage) {
      const plugin = tierResolverUsage.options as TierResolverPlugin;
      resolvedEffectiveFeatures = await plugin.build({ db, registry });
    }
  }

  // 5. Schema-Drift-Gate (drizzle-frei, kumiko/migrations). `kumiko schema
  //    apply` läuft als Deploy-Step VOR dem Container-Rollout. Boot prüft nur:
  //      (a) Alle Migrations aus kumiko/migrations/*.sql sind in
  //          _kumiko_migrations applied (+ checksum unverändert)
  //      (b) Alle Tabellen aus kumiko/migrations/.snapshot.json existieren
  //    Drift = Boot-Error mit klarer Meldung (kein Auto-Heal — mehrere
  //    Container-Replicas würden sonst race-conditionen fahren). Opt-out via
  //    `migrations: false` für custom Schema-Setups.
  if (options.migrations !== false) {
    const migrationsDir = options.migrations?.dir ?? "./kumiko/migrations";
    // biome-ignore lint/suspicious/noConsole: boot-time progress hint
    console.log(`[runProdApp] checking schema drift (${migrationsDir})…`);
    try {
      await assertKumikoSchemaCurrent(db, migrationsDir);
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
  const extraContext = addConfigAccessorFactory(
    options.auth
      ? {
          configResolver: createConfigResolver({
            appOverrides: buildEnvConfigOverrides(registry, envSource),
          }),
          ...resolvedExtraContext,
        }
      : resolvedExtraContext,
    registry,
  );
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
  // Secure-by-default: if the sessions feature is mounted, server-side revocation +
  // sessionStrictMode are wired automatically; `auth.sessions` only overrides the config,
  // and `auth.sessions: false` is the explicit opt-out (back to stateless JWTs).
  const sessionsFeatureMounted = features.some((f) => f.name === SESSIONS_FEATURE);
  const sessionAuthFragment = shouldWireProdSessions(
    Boolean(options.auth),
    sessionsFeatureMounted,
    options.auth?.sessions,
  )
    ? buildProdSessionAuth(db, resolveProdSessionsConfig(options.auth?.sessions))
    : undefined;

  const baseEntrypointOptions = {
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
    dispatcherOptions: {
      idempotency,
      ...(resolvedEffectiveFeatures && { effectiveFeatures: resolvedEffectiveFeatures }),
    },
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
        ...(options.auth.cookieDomain !== undefined && {
          cookieDomain: options.auth.cookieDomain,
        }),
        ...(options.auth.allowedOrigins !== undefined && {
          allowedOrigins: options.auth.allowedOrigins,
        }),
        ...(options.auth.unsafeSkipOriginCheck !== undefined && {
          unsafeSkipOriginCheck: options.auth.unsafeSkipOriginCheck,
        }),
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
        ...(options.auth.invite && {
          invite: {
            acceptHandler: AuthHandlers.inviteAccept,
            acceptWithLoginHandler: AuthHandlers.inviteAcceptWithLogin,
            signupCompleteHandler: AuthHandlers.inviteSignupComplete,
            sendInviteEmail: options.auth.invite.sendInviteEmail,
            appAcceptUrl: options.auth.invite.appAcceptUrl,
          },
        }),
      },
    }),
    ...(resolvedAnonymousAccess && { anonymousAccess: resolvedAnonymousAccess }),
  };

  // Deploy-Topologie. Default (Single-Container): createAllInOneEntrypoint
  // fährt HTTP + BEIDE Job-Lanes (zwei Runner, jeder schedult seine eigene
  // Lane-Crons → kein Double-Fire) + Event-Dispatcher inline. So laufen
  // worker-Lane-Crons (run-export-jobs default runIn:"worker") UND MSPs ohne
  // separaten Worker-Process — die Asymmetrie, an der der Daten-Export hing.
  // runSingleInstance:false → API-only; ein dezidierter Worker MUSS dann die
  // worker-Lane + MSPs übernehmen (api-Lane-Jobs laufen weiter lokal).
  // Default single-instance. eventDispatcher.disabled ist die Alt-Art, MSPs
  // diesem Prozess wegzunehmen (dezidierter Worker) — als runSingleInstance:
  // false honorieren (api-only, kein lokaler Dispatcher), damit der explizite
  // Flag Vorrang behält aber Bestands-Caller nicht brechen.
  const runSingleInstance = options.runSingleInstance ?? options.eventDispatcher?.disabled !== true;
  const hasJobs = registry.getAllJobs().size > 0;
  const queueNamePrefix = options.jobs?.queueNamePrefix;
  const dispatcherTunables =
    options.eventDispatcher?.pollIntervalMs !== undefined
      ? { pollIntervalMs: options.eventDispatcher.pollIntervalMs }
      : {};

  const entrypoint: ApiEntrypoint | AllInOneEntrypoint = runSingleInstance
    ? createAllInOneEntrypoint({
        ...baseEntrypointOptions,
        // Worker-Seite liest die JobsBlock TOP-LEVEL (nicht nested `jobs` wie
        // die api-Seite); beide Lane-Runner ziehen redisUrl/prefix von hier.
        redisUrl,
        ...(queueNamePrefix !== undefined && { queueNamePrefix }),
        ...(!options.eventDispatcher?.disabled && { eventDispatcher: dispatcherTunables }),
      })
    : createApiEntrypoint({
        ...baseEntrypointOptions,
        // API-only: api-Lane-Jobs laufen lokal, ein dezidierter Worker fährt
        // worker-Lane + MSPs. createApiEntrypoint liest den nested `jobs`-Block.
        ...(hasJobs && {
          jobs: {
            redisUrl,
            runLocalJobs: true,
            ...(queueNamePrefix !== undefined && { queueNamePrefix }),
          },
        }),
      });

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

  // 9. Seeds: admin first, then config-seeds from r.config({seeds}),
  //    then app-specific. All idempotent — runProdApp doesn't gate
  //    "first boot" via flag, every seed-step checks its own
  //    preconditions. Config-seeds rely on a deterministic
  //    aggregate-id so re-boot becomes a version_conflict skip.
  if (options.auth) {
    await seedAdmin(db, options.auth.admin);
  }
  await applyBootSeeds({ registry, db });
  for (const seed of options.seeds ?? []) {
    await seed({ db });
  }

  // ES-Operations / Seed-Migrations (Phase 1). Läuft NACH applyBootSeeds +
  // existing seeds-array — die deklarativen Seeds sind die "always-insert-
  // if-missing"-Schicht; seed-migrations sind die "diff-and-update"-
  // Schicht für Drift den existing Seeds nicht erfassen können (z.B.
  // Membership-Roles-Change nach initialer Seed-Erstellung).
  if (options.seedsDir !== undefined && envSource["KUMIKO_SKIP_ES_OPS"] !== "1") {
    await createEsOperationsTable(db);
    const seedDispatcher = createDispatcher(registry, {
      db,
      redis,
      entityCache,
      registry,
      ...extraContext,
    });
    await runPendingSeedMigrations({
      db,
      seedsDir: options.seedsDir,
      appliedBy: "boot",
      registry, // → dry-run-validator catched handler-QN-typos vor dem write
      // @wrapper-known semantic-alias
      createContext: (dbRunner: DbRunner) =>
        createSeedMigrationContext({ dispatcher: seedDispatcher, dbRunner }),
    });
  }

  await entrypoint.start();

  // 10. App-eigene HTTP-Routes mounten — vor dem static-fallback. Hono
  //     matcht in Eintrags-Reihenfolge, also greifen explizite Routen
  //     der App (z.B. /feed.xml) bevor der Static-Fallback nach Disk-
  //     Files sucht. Eingehende /api/*-Pfade sind schon vom dispatcher
  //     belegt; extraRoutes sollte die nicht überschreiben (kein
  //     enforce, das ist Author-Verantwortung).
  if (options.extraRoutes) {
    options.extraRoutes(entrypoint.app, {
      db,
      redis,
      registry,
      dispatchSystemWrite: makeDispatchSystemWrite(entrypoint.dispatcher),
    });
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
): Promise<
  { readonly bytes: Uint8Array; readonly mime: string; readonly mtimeMs: number } | undefined
> {
  try {
    const { readFile, stat } = await import("node:fs/promises");
    const [bytes, fileStat] = await Promise.all([readFile(filePath), stat(filePath)]);
    return { bytes, mime: mimeTypeFor(filePath), mtimeMs: fileStat.mtimeMs };
  } catch (err) {
    if ((err as { code?: string }).code === "ENOENT") return undefined;
    throw err;
  }
}

function serveDiskFile(
  req: Request,
  pathname: string,
  file: {
    readonly bytes: Uint8Array;
    readonly mime: string;
    readonly mtimeMs: number;
  },
): Response {
  return cachedResponse(req, {
    // @cast-boundary bun-types — Response BodyInit narrowing
    body: file.bytes as unknown as BodyInit,
    etag: computeWeakEtag(file.mtimeMs, file.bytes.byteLength),
    cache: staticCachePolicy(pathname),
    headers: { "content-type": file.mime },
    lastModified: new Date(file.mtimeMs),
  });
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
  ): Promise<{ bytes: ArrayBuffer; mime: string; etag: string; mtimeMs: number } | null> {
    const file = await readStaticFile(path);
    if (!file) return null;
    if (!injectSchemaInto) {
      return {
        bytes: file.bytes.buffer.slice(
          file.bytes.byteOffset,
          file.bytes.byteOffset + file.bytes.byteLength,
        ) as ArrayBuffer,
        mime: file.mime,
        etag: computeWeakEtag(file.mtimeMs, file.bytes.byteLength),
        mtimeMs: file.mtimeMs,
      };
    }
    const text = new TextDecoder().decode(file.bytes);
    const injected = injectSchema(text, appSchemaJson);
    const bytes = new TextEncoder().encode(injected).buffer as ArrayBuffer;
    return {
      bytes,
      mime: file.mime,
      etag: computeStrongEtag(new Uint8Array(bytes)),
      mtimeMs: file.mtimeMs,
    };
  }

  function serveHtmlFile(
    req: Request,
    pathname: string,
    html: { bytes: ArrayBuffer; mime: string; etag: string; mtimeMs: number },
    extraHeaders?: Record<string, string>,
  ): Response {
    return cachedResponse(req, {
      body: html.bytes,
      etag: html.etag,
      cache: staticCachePolicy(pathname),
      headers: { "content-type": html.mime, ...extraHeaders },
      lastModified: new Date(html.mtimeMs),
    });
  }

  // hostDispatch konsultieren wenn gesetzt UND der Request auf den
  // HTML-Fallback fällt (Root oder SPA-Route). Returnt entweder die
  // resolved Response (redirect/404/html) oder null wenn der Default-
  // Pfad weiterlaufen soll.
  async function tryHostDispatch(req: Request): Promise<Response | null> {
    if (!hostDispatch) return null;
    const url = new URL(req.url);
    const host = req.headers.get("host") ?? url.host;
    const result = hostDispatch({ host, path: url.pathname, search: url.search });
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
    // Per-Host-Body (hostDispatch wählt die Datei nach Host) → Vary: Host,
    // sonst darf ein Shared-Cache Tenant-As Schema an Tenant B liefern.
    const extraHeaders: Record<string, string> = { vary: "Host" };
    if (result.csp) extraHeaders["content-security-policy"] = result.csp;
    return serveHtmlFile(req, "/index.html", html, extraHeaders);
  }

  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    // /api/* and /health → always Hono (Dispatcher + Health-Probe).
    if (url.pathname.startsWith("/api/") || url.pathname === "/health") {
      return apiHandler(req);
    }

    // Hono-First für andere Pfade: extraRoutes (z.B. /feed.xml,
    // /sitemap.xml) UND r.httpRoute-Features (z.B. /legal/*) müssen vor
    // dem Disk-Lookup greifen, sonst schluckt der SPA-Fallback unten
    // unbekannte Pfade als index.html. Shared mit dev-server's
    // createKumikoServer.handleFetch damit beide IDENTISCHE Semantik haben.
    const honoTry = await tryHonoFirst({ fetch: apiHandler }, req);
    if (honoTry.matched) {
      return honoTry.response;
    }
    const honoRes = honoTry.response;

    // Disk-/SPA-Fallback ist GET/HEAD-only. Ein non-GET ohne Hono-Match
    // (z.B. POST auf einen falsch konfigurierten Webhook-Pfad) muss den
    // Hono-404 durchreichen — 200 index.html würde dem Provider
    // "delivered" signalisieren und Events gingen still verloren (#259).
    if (req.method !== "GET" && req.method !== "HEAD") {
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
        return serveDiskFile(req, url.pathname, file);
      }
    }

    // Root oder SPA-Route — hier greift hostDispatch wenn gesetzt.
    // Ohne hostDispatch: alter Single-App-Pfad (index.html mit Schema).
    const dispatched = await tryHostDispatch(req);
    if (dispatched) return dispatched;

    // Default Single-App-Pfad: index.html, schema injected.
    const index = await readHtmlFile(indexHtml, true);
    if (index) {
      return serveHtmlFile(req, "/index.html", index);
    }

    // Kein Hono-Match, keine Disk-Datei, kein index.html → liefer den
    // ursprünglichen 404 von Hono durch (statt einen neuen Roundtrip).
    return honoRes;
  };
}

// Map URL-Pfad → Cache-Policy. Hashed-Asset-Pfade (/assets/*) sind
// unveränderlich, der Rest bleibt revalidate/no-cache damit Updates ohne
// Hard-Reload greifen. Exported für Unit-Tests; Konsumenten gehen via
// runProdApp.
export function staticCachePolicy(pathname: string): CachePolicy {
  if (pathname.startsWith(`/${ASSETS_DIR}/`)) {
    return { kind: "immutable" };
  }
  if (pathname === "/" || pathname === "/index.html") {
    return { kind: "revalidate" };
  }
  if (
    pathname === "/manifest.json" ||
    pathname === "/sw.js" ||
    // ponytail: build-info.json ist statisch — kein /api/version-Endpoint
    // nötig, der Disk-Fallback serviert sie. no-cache, sonst pollt der
    // UpdateChecker eine veraltete id.
    pathname === "/build-info.json"
  ) {
    return { kind: "no-cache" };
  }
  return { kind: "none" };
}

function buildProdSessionAuth(
  db: import("@cosmicdrift/kumiko-framework/db").DbConnection,
  opts: ProdSessionsConfig,
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
