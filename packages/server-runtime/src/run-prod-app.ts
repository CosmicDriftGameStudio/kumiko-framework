/// <reference types="bun-types" preserve="true" />
// runProdApp — production-grade bootstrap wrapper for Kumiko apps.
//
// Symmetric with runDevApp, but:
//   - DATABASE_URL / REDIS_URL / JWT_SECRET come from env (fail-fast at boot;
//     no ephemeral test databases)
//   - Hard schema-drift gate: checks kumiko/migrations against
//     _kumiko_migrations and verifies every expected table with tableExists.
//     Boot never runs CREATE TABLE automatically; migrations are applied by
//     CI (`bun kumiko schema apply`) and boot only validates them. This avoids
//     races in multi-replica deployments and keeps schema state reviewable.
//   - Idempotent seeds run only when the database is empty, using an
//     `isDbEmpty` probe per seed. Reboots after the first seed are no-ops.
//   - HTTP server via Bun.serve with graceful SIGTERM/SIGINT → drain().
//   - Auth routes and bundled features are mixed automatically when `auth:` is
//     set, using the same logic as runDevApp.
//
// App authors write:
//   await runProdApp({ features, envSchema, auth, anonymousAccess, seeds });
//
// Container/Coolify sets:
//   DATABASE_URL=postgresql://...
//   REDIS_URL=redis://...
//   JWT_SECRET=<random-32+>  (always required — also signs password-reset and
//     email-verification HMAC tokens, a separate non-rotating token family)
//     — additionally, for zero-downtime rotation of the session-JWT signing
//     key specifically:
//   JWT_SECRET_V1=<random-32+>  (repeat _V2, _V3, ... per rotation)
//   JWT_SECRET_CURRENT_VERSION=1  (which V<n> signs new tokens; the others
//     still verify in-flight tokens until they expire)
//   When adopting rotation for the first time (with no JWT_SECRET_V<n> set),
//   the plain JWT_SECRET remains set and is carried into the keyring as a
//   verify-only legacy key (loadJwtSecretOrKeyring), so sessions signed before
//   cutover continue to verify without a mass logout. This legacy key never
//   expires automatically; boot logs a warning while it is present. Once the
//   maximum token TTL has elapsed since cutover, unset JWT_SECRET to retire
//   it. First check whether the app relies on auth.mail's convenience default
//   for passwordReset/emailVerification hmacSecret, which falls back to this
//   same JWT_SECRET.
//   PORT=3000
//   KUMIKO_INSTANCE_ID=<stable per replica>

import {
  type AccountLockoutOptions,
  type AccountUnlockOptions,
  AuthErrors,
  AuthHandlers,
  type AuthMailLocale,
  type AuthPaths,
  AuthQueries,
  type EmailVerificationOptions,
  type InviteOptions,
  type PasswordResetOptions,
  type SignupOptions,
} from "@cosmicdrift/kumiko-bundled-features/auth-email-password";
import {
  type SeedAdminOptions,
  seedAdminGuarded,
} from "@cosmicdrift/kumiko-bundled-features/auth-email-password/seeding";
import {
  EXT_SESSION_STORE,
  EXT_TOKEN_VERIFIER,
  resolveAnonymousAccessFromRegistry,
  resolveTokenVerifier,
} from "@cosmicdrift/kumiko-bundled-features/auth-foundation";
import {
  AUTH_MFA_FEATURE,
  AuthMfaHandlers,
  bindMfaTokenSecretsFromFeature,
} from "@cosmicdrift/kumiko-bundled-features/auth-mfa";
import {
  PAT_FEATURE,
  patRateLimitFromFeature,
} from "@cosmicdrift/kumiko-bundled-features/personal-access-tokens";
import { SESSIONS_FEATURE } from "@cosmicdrift/kumiko-bundled-features/sessions";
import { TenantQueries } from "@cosmicdrift/kumiko-bundled-features/tenant";
import { UserQueries } from "@cosmicdrift/kumiko-bundled-features/user";
import {
  createDefaultSseBroker,
  createRedisLoginRateLimiter,
  type ExtraRouteDefinition,
  type KumikoServeEnv,
  type LoginRateLimiter,
  loadJwtSecretOrKeyring,
  type PostAuthLandingResolver,
  type SseBroker,
  type TokenVerifier,
  TRUSTED_PROXY_HOPS_ENV,
  withFileProviderResolver,
} from "@cosmicdrift/kumiko-framework/api";
import {
  configureBlindIndexKey,
  configurePiiSubjectKms,
  type KmsAdapter,
} from "@cosmicdrift/kumiko-framework/crypto";
import {
  configureEntityFieldEncryption,
  createDbConnection,
  type DbRunner,
  dbConnectionOptionsFromEnv,
  outsideTransactionPoolOptionsFromEnv,
  serverTimeoutOptionsFromEnv,
} from "@cosmicdrift/kumiko-framework/db";
import {
  collectWriteHandlerQns,
  createRegistry,
  type EffectiveFeaturesResolver,
  type FeatureDefinition,
  findTierResolverUsage,
  requireTierResolverPlugin,
  type ValidateBootOptions,
  validateAppCustomScreenWriteQns,
  validateBoot,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  type AllInOneEntrypoint,
  type ApiEntrypoint,
  createAllInOneEntrypoint,
  createApiEntrypoint,
} from "@cosmicdrift/kumiko-framework/entrypoint";
import type { ComposedEnvSchema, KumikoBootError } from "@cosmicdrift/kumiko-framework/env";
import type { ErrorDocsConfig } from "@cosmicdrift/kumiko-framework/errors";
import {
  createEsOperationsTable,
  createSeedMigrationContext,
  runPendingSeedMigrations,
} from "@cosmicdrift/kumiko-framework/es-ops";
import { assertSeedModeNotInProduction } from "@cosmicdrift/kumiko-framework/event-store";
import type { JobRunnerOptions } from "@cosmicdrift/kumiko-framework/jobs";
import { createFallbackLogger, setProcessLogger } from "@cosmicdrift/kumiko-framework/logging";
import {
  assertKumikoSchemaCurrent,
  SchemaDriftError,
} from "@cosmicdrift/kumiko-framework/migrations";
import {
  createMetricsForFactory,
  type ObservabilityProvider,
} from "@cosmicdrift/kumiko-framework/observability";
import {
  createDispatcher,
  createEntityCache,
  createEventDedup,
  createIdempotencyGuard,
  createUnlimitedRateLimitResolver,
  flushEscapeHatchAudits,
} from "@cosmicdrift/kumiko-framework/pipeline";
import {
  createRedisCacheSyncBus,
  logRedisConnectionState,
  redisClientOptionsFromEnv,
} from "@cosmicdrift/kumiko-framework/redis";
import type { MasterKeyProvider } from "@cosmicdrift/kumiko-framework/secrets";
import { warnIfNonUtcServerTimeZone } from "@cosmicdrift/kumiko-framework/time";
import type {
  PageHeadMeta,
  PageHeadResolver,
  PageHeadSystemQuery,
} from "@cosmicdrift/kumiko-renderer/headless/apex";
import { Redis } from "ioredis";
import { applyBootSeeds } from "./boot/apply-boot-seeds.ts";
import { resolveBootCrypto } from "./boot/boot-crypto.ts";
import { runEnvGate } from "./boot/env-gate.ts";
import { jobRunLoggerCallbacks } from "./boot/job-run-logger.ts";
import { startPiiEventBackfillOnBoot } from "./boot/pii-event-backfill-on-boot.ts";
import { recordAppStartedOnBoot } from "./boot/record-app-started-on-boot.ts";
import {
  WAIT_FOR_DATABASE_DEADLINE_MS,
  waitForDatabase,
  waitUntilDatabaseReachable,
} from "./boot/wait-for-database.ts";
import type { BillingBootOption } from "./boot-options/billing-option.ts";
import type { DemoModeOption } from "./boot-options/demo-mode.ts";
import type { FileStorageBootOption } from "./boot-options/file-storage-option.ts";
import type { KmsMode } from "./boot-options/kms-mode.ts";
import type { MailBootOption } from "./boot-options/mail-option.ts";
import { installShutdownSignals, type SignalsOption } from "./boot-options/process-signals.ts";
import { resolveBootOptionWiring } from "./boot-options/resolve-boot-options.ts";
import type { ProdSeedsConfig } from "./boot-options/seed-shortcuts.ts";
import { assertStackBootRequirements } from "./boot-options/stack-boot-requirements.ts";
import { buildBunServeOptions, resolveDerivedMaxRequestBodySize } from "./bun-serve-options.ts";
import { buildComposeAuthOptions, composeFeatures } from "./compose-features.ts";
import {
  makeDispatchSystemQuery,
  makeDispatchSystemWrite,
  type SystemWireDeps,
} from "./extra-routes-deps.ts";
import { installFatalErrorHandlers } from "./fatal-error-handlers.ts";
import { assertPiiBootInvariants } from "./pii-boot-gate.ts";
import { installProcessLogger, uninstallProcessLogger } from "./process-logger.ts";
import { type RateLimitOption, resolveRateLimit } from "./rate-limit-defaults.ts";
import { resolveAuthPublicOrigin } from "./resolve-auth-public-origin.ts";
import { resolveUnsubscribeWiring, type UnsubscribeOption } from "./resolve-unsubscribe-wiring.ts";
import {
  addConfigAccessorFactory,
  buildBootExtraContext,
  buildProdSessionAuth,
  type ConfigOverridesInput,
  loggerFromExtraContext,
  resolveAuthMail,
  wireProdPatAutoRevoke,
} from "./run-prod-app-boot-context.ts";
import {
  buildStaticFallback,
  resolveCspScriptHashes,
  resolveHostDispatchScriptHashes,
} from "./run-prod-app-static-files.ts";
import { type SecurityHeadersOption, withSecurityHeaders } from "./security-headers.ts";
import {
  makeSeedCreateFileRef,
  type SeedCreateFileRef,
  withSeedErrorContext,
} from "./seed-dispatcher.ts";
import { assertSessionBootInvariants } from "./session-boot-gate.ts";
import { shouldWireProdSessions } from "./session-wiring.ts";
import { resolveTrustedProxyHops } from "./trusted-proxy-hops.ts";
import { stripNoRouteMatchHeader } from "./try-hono-first.ts";

export { parseRunMode } from "./boot/env-gate.ts";
export { buildBunServeOptions } from "./bun-serve-options.ts";
export {
  resolveUnsubscribeWiring,
  type UnsubscribeOption,
} from "./resolve-unsubscribe-wiring.ts";
export {
  addConfigAccessorFactory,
  buildBootExtraContext,
  type ConfigOverridesInput,
  loggerFromExtraContext,
  resolveAuthMail,
} from "./run-prod-app-boot-context.ts";
export { staticCachePolicy } from "./run-prod-app-static-files.ts";

// Strict env-var read. Throws with a clear hint when missing — better
// than discovering a Postgres-connection-refused 30s into the boot.
// `src` defaults to process.env but is threaded from the caller's envSource
// so the boot-path reads the SAME env-quelle that was validated above —
// injected dummies in test-mode must not silently fall back to process.env.
export function requireEnv(
  name: string,
  src: Record<string, string | undefined> = process.env,
  context = "runProdApp",
): string {
  const value = src[name];
  if (value === undefined || value === "") {
    const advice =
      context === "runProdApp"
        ? "Set it in your container env / .env.production / Coolify secrets."
        : "Set it in your .env / shell before running the dev server.";
    throw new Error(`${context}: required env var "${name}" is missing or empty. ${advice}`);
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
    webSocketUpgradeFetch: async () => new Response("dry-run", { status: 503 }),
    listen: noop,
    stop: noop,
  };
}

/** Wrapper API for the password-reset flow.
 *
 *  Since the delivery migration PasswordResetOptions carries `appUrl`
 *  (+ appName/locale) itself and the handler mails via ctx.notify — no
 *  sendResetEmail callback anymore. Apps pass `auth.mail` (convenience,
 *  resolveAuthMail builds the appUrl) OR an explicit block.
 *
 *  hmacSecret is optional here (unlike PasswordResetOptions): resolveAuthMail
 *  backfills it, so overriding just appUrl needs no secret of its own. */
export type PasswordResetSetup = Omit<PasswordResetOptions, "hmacSecret"> & {
  readonly hmacSecret?: string;
};

/** Wrapper API for the email-verification flow, symmetric to
 *  PasswordResetSetup (appUrl via delivery, optional hmacSecret). */
export type EmailVerificationSetup = Omit<EmailVerificationOptions, "hmacSecret"> & {
  readonly hmacSecret?: string;
};

/** Wrapper API for Magic-Link self-signup. = SignupOptions (appUrl; mail
 *  is sent through delivery/ctx.notify like reset/verify). Unlike reset/verify,
 *  there is no hmacSecret: signup tokens are opaque random values in Redis,
 *  not HMAC-signed. */
export type SignupSetup = SignupOptions;

/** Wrapper API for tenant-invite Magic-Link. = InviteOptions (appUrl; the
 *  invite mail is sent through delivery like reset/verify/signup). The
 *  framework has three accept branches; handler names are fixed in
 *  run-prod-app through AuthHandlers, as with signup. */
export type InviteSetup = InviteOptions;

/** Wrapper API for the account-unlock flow. = AccountUnlockOptions
 *  (appUrl via delivery, symmetric to PasswordResetSetup). Self-service
 *  escape hatch for accountLockout's failure counter; the lockout is always
 *  on, so `auth.mail` mounts this flow by default. */
export type AccountUnlockSetup = Omit<AccountUnlockOptions, "hmacSecret"> & {
  readonly hmacSecret?: string;
};

/** Wrapper API for the account-lockout brute-force guard on the login
 *  handler. = AccountLockoutOptions (maxFailedAttempts, lockoutDurationMinutes
 *  — no mail/appUrl fields, it doesn't mount any routes). Symmetric to
 *  RunDevAppAuthOptions.accountLockout — before this,
 *  `accountUnlock` existed on both wrappers with no way to ever set the
 *  lockout it's meant to escape. */
export type AccountLockoutSetup = AccountLockoutOptions;

/** Auth-mail convenience options shared by runProdApp and runDevApp.
 *  Wires all five mail flows from an env-based SMTP transport and default
 *  templates (see `auth.mail` and resolveAuthMail). */
export type AuthMailOptions = {
  /** App-Basis-URL inkl. Schema (z.B. "https://app.example.com"). */
  readonly baseUrl: string;
  /** App name used in the mail subject and body. Default: "Account". */
  readonly appName?: string;
  /** Locale used by the mail templates. Default: "de". */
  readonly locale?: AuthMailLocale;
  /** "strict" blocks login until emailVerified; "off" mounts the flow without
   *  that gate. */
  readonly emailVerificationMode?: "strict" | "off";
  /** Fallback From address when the `SMTP_FROM` env var is absent; the env var
   *  takes precedence. */
  readonly from?: string;
  /** Overrides single auth paths (default DEFAULT_AUTH_PATHS). */
  readonly paths?: Partial<AuthPaths>;
  /** Reset/verify token secret, decoupled from JWT_SECRET rotation.
   *  Falls back to resolveAuthMail's call-site secret when unset. */
  readonly hmacSecret?: string;
};

export type RunProdAppAuthOptions = {
  /** Initial admin user with a password, seeded once (idempotent — re-boots
   *  check first whether the email is already in the users table). Optional:
   *  passwordless setups provision their first admins via `runBootstrap`
   *  (invitation, global role granted on accept) instead. */
  readonly admin?: SeedAdminOptions;
  /** Optional override of the login error → HTTP status map. */
  readonly loginErrorStatusMap?: Readonly<Record<string, number>>;
  /** Wires all five mail flows (passwordReset, emailVerification, signup,
   *  invite, accountUnlock) from `auth.mail.baseUrl` plus the default paths,
   *  mailing via delivery (ctx.notify).
   *
   *  Without `SMTP_HOST` no flow is wired, since the routes would otherwise
   *  answer 500. An explicit `passwordReset`/`signup`/… block wins over the
   *  mail default for that flow.
   *
   *  Deliberately mounts signup and invite too (self-registration on); apps
   *  that want only reset and verify leave `mail` unset and wire those flows
   *  explicitly, so there is no implicit self-signup. */
  readonly mail?: AuthMailOptions;
  /** Password-reset flow. When set, /api/auth/request-password-reset +
   *  /api/auth/reset-password are mounted as public routes and the
   *  request/confirm handlers are registered (otherwise the routes answer
   *  500). Overrides the `mail` default for this flow. */
  readonly passwordReset?: PasswordResetSetup;
  /** Email-verification flow. Symmetric to passwordReset. */
  readonly emailVerification?: EmailVerificationSetup;
  /** Self-signup flow (Magic-Link). When set, /api/auth/signup-request and
   *  /api/auth/signup-confirm are mounted; signup-confirm mints a JWT and
   *  cookies like a successful login (automatic login after activation). */
  readonly signup?: SignupSetup;
  /** Tenant-Invite flow (Magic-Link). When set, /api/auth/invite-accept,
   *  /api/auth/invite-accept-with-login, /api/auth/invite-signup-complete
   *  are mounted. */
  readonly invite?: InviteSetup;
  /** Account-unlock flow. When set, /api/auth/request-account-unlock
   *  + /api/auth/confirm-account-unlock are mounted. Self-service escape
   *  hatch for accountLockout's monotonic failure-counter — confirming
   *  clears the Redis lockout state, no entity write. */
  readonly accountUnlock?: AccountUnlockSetup;
  /** Brute-force guard on the login handler (maxFailedAttempts,
   *  lockoutDurationMinutes). Mounts no routes — unlike the other flows,
   *  it's a login-handler config knob, not a magic-link flow. Pair with
   *  `accountUnlock` for a self-service escape hatch. */
  readonly accountLockout?: AccountLockoutSetup;
  /** Domain attribute for both auth cookies (see
   *  AuthRoutesConfig.cookieDomain). Set to the registrable parent
   *  domain when login and app live on different subdomains. */
  readonly cookieDomain?: string;
  /** Secure flag for the session cookies (see AuthRoutesConfig.secureCookies).
   *  Defaults to NODE_ENV === "production"; set it to true when TLS ends at a
   *  proxy and NODE_ENV is not "production". */
  readonly secureCookies?: boolean;
  /** Former cookie domains cleared on login/logout (see
   *  AuthRoutesConfig.retiredCookieDomains). */
  readonly retiredCookieDomains?: readonly string[];
  /** Server-side Origin allowlist for the CSRF guard (see
   *  AuthRoutesConfig.allowedOrigins). REQUIRED once `cookieDomain` is set —
   *  buildServer fails closed otherwise. Apex + admin host, never tenant
   *  subdomains. */
  readonly allowedOrigins?: readonly string[];
  /** Opt out of the Origin guard (see AuthRoutesConfig.unsafeSkipOriginCheck)
   *  — accept the wide-cookie CSRF risk explicitly instead of setting
   *  `allowedOrigins`. */
  readonly unsafeSkipOriginCheck?: boolean;
  /** Canonical public origin for the default Origin guard (see
   *  AuthRoutesConfig.publicOrigin). Defaults to the origin of
   *  `mail.baseUrl`, then of the APP_BASE_URL env. */
  readonly publicOrigin?: string;
  /** Number of trusted reverse-proxy hops between the client and this
   *  process for client-IP derivation (see AuthRoutesConfig.trustedProxyHops)
   *  — closes the X-Forwarded-For spoofing hole on the auth rate-limiters.
   *  Falls back to the `KUMIKO_TRUSTED_PROXY_HOPS` env var when unset; both
   *  unset means 0 hops, the safe socket-only default (only the socket address
   *  counts, XFF ignored). Deprecated in favor of the top-level
   *  `trustedProxyHops` option, which wins over this and the env var. */
  readonly trustedProxyHops?: number;
  /** Server-computed post-auth redirect (see AuthRoutesConfig.postAuthLanding).
   *  Result lands in the login/signup/invite response as `landingPath`; an
   *  invalid path or a throwing resolver just omits the field. */
  readonly postAuthLanding?: PostAuthLandingResolver;
};

/** Hook for app-specific seeding — runs after the admin (when auth is
 *  active). Each seed is responsible for its own idempotence (seeds are
 *  expected to check "is my row already there?" before inserting). Write
 *  through `dispatcher.write(...)` rather than `db` so projections and
 *  hooks run; `registry` is the boot registry. */
export type ProdSeedFn = (deps: {
  db: import("@cosmicdrift/kumiko-framework/db").DbConnection;
  registry: import("@cosmicdrift/kumiko-framework/engine").Registry;
  dispatcher: import("@cosmicdrift/kumiko-framework/pipeline").Dispatcher;
  /** Stores bytes as a fileRef of `tenantId` (same validation and storage
   *  layout as POST /files) without a helper write handler. */
  createFileRef: SeedCreateFileRef;
  /** Present when a master key is configured: decrypts the same keys the handlers do, so a seed need not resolve the KEK itself. */
  masterKeyProvider?: import("@cosmicdrift/kumiko-framework/secrets").MasterKeyProvider;
  configEncryption?: import("@cosmicdrift/kumiko-framework/secrets").EnvelopeCipher;
}) => Promise<void>;

/** Dependencies passed to the `extraContext` and `anonymousAccess` factories.
 *  The returned config can close over them, for example a TenantResolver that
 *  queries `db` or an extra-context provider that publishes SSE events. The
 *  shape matches setupTestStack so test and production wiring remain aligned. */
export type RunProdAppDeps = {
  readonly db: import("@cosmicdrift/kumiko-framework/db").DbConnection;
  readonly redis: Redis;
  readonly registry: import("@cosmicdrift/kumiko-framework/engine").Registry;
  readonly sseBroker: SseBroker;
  /** The env the boot runs on: process env or `envSource`, with the boot-option defaults (e.g. `fileStorage`) underneath. */
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Present when a master key is configured; the same keyring the handlers use. */
  readonly masterKeyProvider?: import("@cosmicdrift/kumiko-framework/secrets").MasterKeyProvider;
  readonly configEncryption?: import("@cosmicdrift/kumiko-framework/secrets").EnvelopeCipher;
};

export type AnonymousAccessOption =
  | import("@cosmicdrift/kumiko-framework/api").AnonymousAccessConfig
  | ((deps: RunProdAppDeps) => import("@cosmicdrift/kumiko-framework/api").AnonymousAccessConfig);

export type ExtraContextOption =
  | Record<string, unknown>
  | ((deps: RunProdAppDeps) => Record<string, unknown>);

/** Per-host routing decision for the staticDir fallback, returned from
 *  hostDispatch. Three modes:
 *    - "html": serve a specific HTML file (relative to staticDir), optionally
 *      with CSP. HTML never carries a schema — createKumikoApp fetches it
 *      itself from the authenticated GET /api/schema, after the
 *      clientFeature gates (auth) let it through.
 *    - "redirect": 301/302 to the given location.
 *    - "not-found": reject (e.g. unknown subdomain) with a plain 404, or —
 *      with `file` (+ optional `csp`) — serve that page with status 404.
 *
 *  Only consulted when the path would otherwise fall through to the HTML
 *  fallback — i.e. for "/", "/index.html", or SPA routes that neither Hono
 *  matches nor a concrete disk file. Asset paths (/assets/*) and API paths
 *  run independent of the host. */
export type HostDispatchResult =
  | {
      readonly kind: "html";
      readonly file: string;
      /** @deprecated Ignored — HTML never carries the schema; createKumikoApp
       *  fetches it from the authenticated GET /api/schema. Removed in 0.390.0. */
      readonly injectSchema?: boolean;
      readonly csp?: string;
    }
  | { readonly kind: "redirect"; readonly to: string; readonly status?: 301 | 302 }
  | { readonly kind: "not-found"; readonly file?: string; readonly csp?: string };

export type HostDispatchFn = (
  req: {
    readonly host: string;
    readonly path: string;
    /** Query string incl. leading `?`, `""` if none. Redirects that
     *  route the path to a different host (e.g. auth routes with
     *  `?token=` from old mail links) MUST append it to `to`. */
    readonly search: string;
  },
  /** `systemQuery` runs as the anonymous role (like PageHeadSystemQuery) —
   *  hostDispatch is reachable by any public visitor, same access gate as a
   *  real anonymous request. Lets a Multi-Tenant hostDispatch look up the
   *  tenant for a subdomain instead of needing its own db handle. */
  deps: {
    readonly systemQuery: PageHeadSystemQuery;
    /** Raw `sha256-…` hashes of the build's inline scripts (csp-hashes.json), for a per-host CSP without 'unsafe-inline'. */
    readonly cspScriptHashes: readonly string[];
  },
) => HostDispatchResult | Promise<HostDispatchResult>;

// PageHeadMeta/PageHeadResolver/PageHeadSystemQuery moved to
// @cosmicdrift/kumiko-renderer/headless/apex — runDevApp needs
// the same types and the same resolve+inject function runProdApp uses, and
// headless is where renderApexHeadTags already lives. Re-exported here so
// existing subpath-imports (`@cosmicdrift/kumiko-server-runtime/run-prod-app`)
// keep working unchanged.
export type { PageHeadMeta, PageHeadResolver, PageHeadSystemQuery };

export type RunProdAppOptions = {
  /** App-specific features. config/user/tenant/auth-email-password are
   *  auto-mixed when `auth:` is set — don't add them yourself. */
  readonly features: readonly FeatureDefinition[];
  /** Opt-in boot-validator warnings — see ValidateBootOptions. */
  readonly validateBootOptions?: ValidateBootOptions;
  /** Listen-Port. Default 3000 (or $PORT). */
  readonly port?: number;
  /** Ceiling Bun.serve buffers a request body to before any app-level
   *  body-limit middleware runs. Default is derived from `createFilesFeature`'s
   *  configured `maxUploadSize`/field `maxSize` (see
   *  resolveDerivedMaxRequestBodySize in bun-serve-options.ts) — override
   *  only for a custom ceiling unrelated to that config. */
  readonly maxRequestBodySize?: number;
  /** Auth-mode: standard features + routes wired, admin seeded. */
  readonly auth?: RunProdAppAuthOptions;
  /** Custom seed functions, run after the admin seed (when auth-mode). The
   *  object form adds the declarative demo-tenant / demo-admin / sysadmin
   *  seeds from the env and takes the functions under `run`; see
   *  `ProdSeedsConfig`.
   *  @example
   *  seeds: { demoTenant: { key: "demo", name: "Demo" }, sysadminFromEnv: true, run: [seedDemoData] } */
  readonly seeds?: readonly ProdSeedFn[] | ProdSeedsConfig;
  /** Path to the seeds directory for ES operations and seed migrations
   *  (file-based like drizzle-migrate). When set and KUMIKO_SKIP_ES_OPS != "1",
   *  runProdApp scans it for `<id>.ts` files, diffs them against the
   *  kumiko_es_operations table, and runs pending operations in a transaction. */
  readonly seedsDir?: string;
  /** Anonymous access for public endpoints (same shape as runDevApp).
   *  Accepts either a static config object or a factory
   *  `({db, redis, registry}) => Config`, called once at boot after
   *  db/redis/registry have been constructed. The factory can close over these
   *  dependencies so a TenantResolver can look up a subdomain in the database. */
  readonly anonymousAccess?: AnonymousAccessOption;
  /** Static-file root for HTML / assets. Served on the catch-all route
   *  for any path that doesn't match an /api/ handler. Use this for the
   *  public status page HTML, embed widget JS, etc. */
  readonly staticDir?: string;
  /** Host-aware routing hook for multi-tenant + multi-app deployments
   *  (e.g. publicstatus's `<sub>.publicstatus.eu` (public page) +
   *  `admin.publicstatus.eu` (admin UI) + `publicstatus.eu` (apex/
   *  marketing) in the SAME container).
   *
   *  Called when the staticDir fallback would generate an HTML response
   *  (root or SPA route). Default behavior without hostDispatch: index.html
   *  (single-app), no schema.
   *
   *  Schema safety: HTML (per-host as well as single-app) never carries an
   *  AppSchema — createKumikoApp fetches it via GET /api/schema, which sits
   *  behind the auth middleware and only serves non-anonymous, signed-in
   *  users. Per-host CSP headers can additionally restrict asset paths. */
  readonly hostDispatch?: HostDispatchFn;
  /** Per-request head-metadata resolver (Open-Graph/title/description) for
   *  the static-fallback HTML shell — see `PageHeadResolver`. Consulted on
   *  the same two HTML-serving paths as `hostDispatch` (host-dispatched
   *  HTML + the default single-app index.html), right before the response
   *  is sent. On error, `null`, or a resolve time over 300ms, the shell
   *  ships unchanged with status 200 — this must never turn into a 500 or
   *  a blank page. `systemQuery` inside the resolver runs as the
   *  anonymous role (not system) — the resolver is reachable by any
   *  public visitor, same access gate as a real anonymous request. */
  readonly resolvePageHead?: PageHeadResolver;
  /** Path to kumiko/migrations for the boot gate. Default "./kumiko/migrations"
   *  relative to the process cwd. Boot throws SchemaDriftError on pending
   *  migrations or missing tables. `false` disables the gate for setups that
   *  run their own schema check. */
  readonly migrations?: { readonly dir: string } | false;
  /** Extra AppContext keys. Framework defaults are added at boot beneath the
   *  factory values; app values always win:
   *    - `templateResolver` (createTemplateResolverApi(db, registry)), always
   *    - `secrets` (createSecretsContext), only when the `secrets` feature is
   *      mounted (no KEK env requirement otherwise)
   *    - `configResolver`, in auth mode (env-config-overrides)
   *  Accepts a static object or a factory
   *  `({db, redis, registry}) => Record<string, unknown>`, like `anonymousAccess`. */
  /** Boot default locale (BCP-47) for ctx.locale when the request carries
   *  no locale signal. Merged into AppContext before extraContext (app wins). */
  readonly defaultLocale?: string;
  readonly extraContext?: ExtraContextOption;
  /** MasterKeyProvider replacing the env KEK (`KUMIKO_SECRETS_MASTER_KEY_V<n>`)
   *  for `ctx.secrets`, encrypted config keys and `encrypted: true` entity
   *  fields. Default: `createEnvMasterKeyProvider`. Use it for KMS backends
   *  (AWS/GCP/Azure); with it set, `KUMIKO_SECRETS_MASTER_KEY_V1` is not
   *  required in the env. */
  readonly masterKey?: MasterKeyProvider;
  /** Subject-key adapter for crypto-shredding (GDPR Art. 17). When set, it is
   *  exposed to feature code as `ctx.kms`, and boot checks its health so the app
   *  cannot start against an unreachable KMS. Without an adapter,
   *  crypto-shredding remains disabled. */
  readonly kms?: KmsAdapter;
  /** 32-byte base64 key for blind-index HMACs on `lookupable` fields
   *  (env: KUMIKO_BLIND_INDEX_KEY, `openssl rand -base64 32`). It is separate
   *  from PLATFORM_KEK and not part of the KmsAdapter contract. It is required
   *  when `kms` is set and a feature declares lookupable fields; otherwise
   *  equality lookups on ciphertext, such as login by email, fail and boot
   *  aborts. */
  readonly blindIndexKey?: string;
  /** Explicit opt-out from the strict PII boot gate. Features may declare
   *  pii/userOwned/tenantOwned fields without a provisioned `kms`; those fields
   *  remain plaintext in rows and events, and GDPR erasure through
   *  crypto-shredding is unavailable. The value records the reason for the
   *  audit trail (for example, "kms rollout pending"). Without this flag and
   *  without `kms`, boot aborts. */
  readonly allowPlaintextPii?: string;
  /** Short form over `kms` / `blindIndexKey` / `allowPlaintextPii` that wires
   *  the subject-key KMS from the env; not combinable with them. Unset keeps
   *  today's behavior: no KMS unless `kms` is passed, and the PII boot gate
   *  aborts when PII fields exist without one. See `KmsMode`.
   *  @example
   *  kmsMode: "required" */
  readonly kmsMode?: KmsMode;
  /** App-wide mail transport: mounts `channel-email` and wires the `auth.mail`
   *  flows without an `SMTP_HOST` probe. See `MailBootOption`.
   *  @example
   *  mail: { transport: "smtp-env", from: "Acme <noreply@acme.example>" } */
  readonly mail?: MailBootOption;
  /** File provider for `file-foundation` plus the `FILE_STORAGE_PROVIDER`
   *  default. See `FileStorageBootOption`.
   *  @example
   *  fileStorage: { provider: "auto" } */
  readonly fileStorage?: FileStorageBootOption;
  /** Stripe billing: `subscription-stripe` plus the tier-syncing webhook
   *  route. Needs `billing-foundation` and `tier-engine`. See `BillingBootOption`.
   *  @example
   *  billing: { stripe: { priceToTier: { [env.STRIPE_PRICE_PRO]: "pro" } }, defaultTier: "free" } */
  readonly billing?: BillingBootOption;
  /** Global operator switches: mounts `feature-toggles` and layers them over the tier resolver, so
   *  an operator can switch a feature off for every tenant. */
  readonly featureToggles?: boolean;
  /** Live-demo mode: read-only gate in the fetch chain plus the anonymous
   *  `GET /demo-mode` route. See `DemoModeOption`.
   *  @example
   *  demoMode: { readOnly: env.DEMO_READ_ONLY === "true", notice: { text: { en: "Read-only demo" } } } */
  readonly demoMode?: DemoModeOption;
  /** SIGTERM/SIGINT handling of `listen()`: drains via `stop()` (default
   *  timeout 25 s), exits 0, or 1 when the drain fails or times out. `false`
   *  leaves the signals to the app.
   *  @example
   *  signals: { drainTimeoutMs: 10_000 } */
  readonly signals?: SignalsOption;
  /** Deploy topology. Default `true` (single container): this process runs
   *  HTTP, both job lanes (api + worker) and the event dispatcher (MSP apply)
   *  inline via `createAllInOneEntrypoint`. Worker-lane crons (e.g. the data
   *  export `run-export-jobs`, default `runIn:"worker"`), the delivery jobs
   *  `delivery.render`/`delivery.send` (worker lane; mail, push and chat
   *  delivery) and r.multiStreamProjection then run without a separate worker.
   *
   *  Set `false` ONLY with a dedicated worker deployment: this process then
   *  runs API-only (`createApiEntrypoint`) and no longer applies worker-lane
   *  jobs or MSPs locally. The worker has to take them over, otherwise export
   *  jobs and queued delivery attempts (email/push/chat) stay pending and the
   *  read side stays empty (2026-06-11 incident class). */
  readonly runSingleInstance?: boolean;
  /** With `runSingleInstance: false`: the worker mounts the same mail / fileStorage features
   *  (its own boot options or by hand), so the boot warning about them stays silent. */
  readonly workerMountsFeatures?: boolean;
  /** Job settings. Jobs a feature registers with `r.job(...)` are wired
   *  automatically (see runSingleInstance). */
  readonly jobs?: {
    /** BullMQ-Queue-Prefix (default "kumiko"). */
    readonly queueNamePrefix?: string;
    /** Source of active tenant ids for `perTenant: true` jobs. Omit when the
     *  tenant feature is mounted — the framework then resolves tenants on
     *  its own via that feature's active-tenant-ids query. Only needed when
     *  the app manages tenants outside that feature. */
    readonly getActiveTenantIds?: JobRunnerOptions["getActiveTenantIds"];
  };
  /** Event dispatcher (MSP application) in the API process. Enabled by default
   *  because the single-container deployment has no separate worker process to
   *  apply multiStreamProjections. Set `disabled: true` only when a dedicated
   *  worker process takes over the dispatcher. */
  readonly eventDispatcher?: {
    readonly disabled?: boolean;
    /** Dispatcher-loop polling interval (default: see createEventDispatcher).
     *  LISTEN/NOTIFY wiring comes with a later pgClient pass-through. */
    readonly pollIntervalMs?: number;
  };
  /** Declarative HTTP-routes outside the /api/write|query|batch pipeline —
   *  each entry declares its access tier (`entry`: "anonymous" | "user" |
   *  "signature"), buildServer wires the matching guard + deps. Mounted
   *  inside buildServer, right after the r.httpRoute loop, before seeds. */
  readonly extraRoutes?: readonly ExtraRouteDefinition[];
  /** Framework-managed unsubscribe links. Mounts `createUnsubscribeRoutes({ secret })` and makes
   *  delivery sign `data.unsubscribeUrl` (path `DELIVERY_UNSUBSCRIBE_PATH`) for every email
   *  notification declared with `unsubscribe: true`, for user and `route` recipients; a link the
   *  caller put into `data.unsubscribeUrl` wins. `secret` must be dedicated (≥32 chars), not the
   *  session JWT secret. Links point at the origin of `auth.publicOrigin`, then `auth.mail.baseUrl`,
   *  then the `APP_BASE_URL` env; with none of them no link is added (boot warning). Address
   *  recipients need a blind-index key, otherwise they get no link. Do not also mount
   *  `createUnsubscribeRoutes` via `extraRoutes`. `tenantOrigin` points a tenant's links at
   *  its own subdomain or custom domain (the host must serve this app's `/api` routes); null,
   *  a throw or a non-https value fall back to the app origin. The link carries the mail's
   *  locale, so the confirmation pages speak the mail's language. An app reacts to an address
   *  opt-out with an `r.job` triggered on `DeliveryHandlers.unsubscribeAddress`. */
  readonly unsubscribe?: UnsubscribeOption;
  /** Hook for app-wired co-running components that need the system-write
   *  dispatcher (e.g. wiring a webhook plugin's system-scoped secrets, or
   *  starting a co-running supervisor) — runs after buildServer, before
   *  seeds, with NO `app` (routes are declared via `extraRoutes`, not
   *  wired here). */
  readonly wire?: (deps: SystemWireDeps) => void | Promise<void>;
  /** When true (default), Bun.serve is started before runProdApp resolves —
   *  the common case: `await runProdApp({...})` boots the server and the
   *  process stays up listening on PORT. Set to false in tests that drive
   *  the fetch-handler directly (Bun.serve isn't available under vitest +
   *  node), then call handle.listen() manually if needed. */
  readonly autoListen?: boolean;
  /** App-level config values (tenant model, branding, seo ...) keyed by the qualified config
   *  key. Validated against the registered keys at boot; they win over the key's env variable
   *  and sit below tenant and user values. */
  readonly appOverrides?: ConfigOverridesInput;
  /** Composed Zod-schema for env-validation (from `composeEnvSchema({
   *  core, features, extend })` in @cosmicdrift/kumiko-framework/env):
   *  - `process.env` is parsed against it BEFORE any boot work; missing
   *    or invalid vars throw a `KumikoBootError` listing ALL problems
   *    at once (not first-fail).
   *  - `KUMIKO_DRY_RUN_ENV=human|json|pulumi|k8s` introspects the schema
   *    and prints the env-var inventory, then exits without booting.
   *  - `KUMIKO_DRY_RUN_ENV=boot` prints a per-variable table. With required
   *    values missing it exits 0 without validating the feature wiring; an
   *    invalid value exits 1; a complete env runs the boot validators. */
  readonly envSchema: ComposedEnvSchema;
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
  /** Observability provider (tracer and meter). Default: Noop, with no overhead
   *  or `/metrics` endpoint. Supply a provider based on
   *  `createPrometheusMeter()` together with `metrics` to expose `/metrics`. */
  readonly observability?: ObservabilityProvider;
  /** Enables the `/metrics` endpoint in OpenMetrics format. Without a
   *  PrometheusMeter-based `observability` provider, `/metrics` returns 503
   *  with a misconfiguration message instead of real metrics. */
  readonly metrics?: import("@cosmicdrift/kumiko-framework/api").ServerOptions["metrics"];
  /** L1 (global per-IP limit) + L2 (auth endpoints) rate-limit middleware, passed
   *  to `buildServer`'s `ServerOptions.rateLimit`. Without a value L1 allows 600/60 s
   *  and L2 30/60 s; a partial value overrides only the fields it names, `false`
   *  (whole option or one layer) switches it off. Behind a reverse proxy the
   *  client-IP key needs `trustedProxyHops`, otherwise all clients share one bucket. */
  readonly rateLimit?: RateLimitOption;
  /** Default security headers on every response (HSTS, X-Frame-Options,
   *  X-Content-Type-Options, Referrer-Policy, Content-Security-Policy with
   *  the build's inline-script hashes). Headers already set by a response
   *  (e.g. hostDispatch's per-host CSP) are never overridden. `false`
   *  disables the whole block; per-header overrides via the object form —
   *  see SecurityHeadersOption. */
  readonly securityHeaders?: SecurityHeadersOption;
  /** Number of trusted reverse-proxy hops for client-IP resolution — 1:1
   *  durchgereicht an `buildServer`s
   *  top-level `ServerOptions.trustedProxyHops`. Wins over the deprecated
   *  `auth.trustedProxyHops` and `KUMIKO_TRUSTED_PROXY_HOPS`. Default 0 =
   *  trust no proxy header, only the socket address (or "unknown") counts. */
  readonly trustedProxyHops?: number;
  /** Links the app's own error reasons to its own docs (`docsUrl` in error responses); framework reasons keep the framework docs link. */
  readonly errorDocs?: ErrorDocsConfig;
};

export type ProdAppHandle = {
  /** The composed entrypoint — AllInOne (runSingleInstance, default) or
   *  Api-only (runSingleInstance:false). In KUMIKO_DRY_RUN_ENV mode WITH
   *  `envSource` injected (test path), no boot ran and this slot is an
   *  undefined-cast — do not access. Production dry-run hits
   *  `process.exit(0)` before returning a handle. */
  readonly entrypoint: ApiEntrypoint | AllInOneEntrypoint;
  /** The fetch-handler — wired into Bun.serve in production, called
   *  directly in tests. Composes Hono + static-fallback. Apps with
   *  `autoListen: false` that call `Bun.serve` themselves must pass the
   *  2nd arg from `server.requestIP(req)?.address`, extracted in their
   *  outermost Bun fetch callback — `requestIP` only resolves for Bun's
   *  original Request instance, never a cloned/rebuilt one. */
  readonly fetch: (req: Request, socketAddress?: string) => Promise<Response> | Response;
  /** Serves WebSocket-upgrade requests (r.webSocketRoute) with Bun's original
   *  Request. Apps with `autoListen: false` that run their own `Bun.serve`
   *  must pass it as `{ upgradeFetch }` in the 4th argument of `buildBunServeOptions` to get
   *  WebSockets; `listen()` already wires it. */
  readonly webSocketUpgradeFetch: (req: Request, env: KumikoServeEnv) => Promise<Response>;
  /** Active Bun-server (only set when listen() was called — tests skip
   *  listen() because Bun.serve isn't available under vitest/node). */
  server?: ReturnType<typeof Bun.serve>;
  /** Bind to PORT and start serving. Production calls this; tests don't. */
  readonly listen: (port?: number) => Promise<void>;
  readonly stop: () => Promise<void>;
};

const SERVER_GRACEFUL_STOP_MS = 10_000;

// stop() without force waits for open connections (SSE never ends on its own); force-close after the grace period.
async function stopServerGracefully(server: { stop(closeActiveConnections?: boolean): unknown }) {
  let graceTimer: ReturnType<typeof setTimeout> | undefined;
  const graceElapsed = new Promise<void>((resolve) => {
    graceTimer = setTimeout(resolve, SERVER_GRACEFUL_STOP_MS);
  });
  try {
    await Promise.race([server.stop(), graceElapsed]);
  } finally {
    clearTimeout(graceTimer);
  }
  await server.stop(true);
}

let warnedLegacyJwtSecret = false;
function warnLegacyJwtSecretOnce(): void {
  // skip: already warned once this process — avoid log spam on every boot path.
  if (warnedLegacyJwtSecret) return;
  warnedLegacyJwtSecret = true;
  createFallbackLogger("runProdApp").warn(
    "JWT keyring carries a legacy (pre-rotation) verify-only key — " +
      "it never expires on its own. JWT_SECRET remains a required env (hmacSecret " +
      "fallback + boot requireEnv). To stop verifying with the pre-rotation secret: " +
      "set auth.mail.hmacSecret explicitly, then rotate JWT_SECRET to a fresh value " +
      "that is no longer present in any in-flight token (see resolveAuthMail / " +
      "loadJwtSecretOrKeyring).",
  );
}

export async function runProdApp(options: RunProdAppOptions): Promise<ProdAppHandle> {
  assertSeedModeNotInProduction();
  // 0. Env-Schema validation + dry-run modes. Runs FIRST so:
  //    - operators can introspect env-requirements without a real boot
  //      (no DB connection needed, KUMIKO_DRY_RUN_ENV=… → render + exit)
  //    - missing/invalid env-vars produce a structured KumikoBootError
  //      with ALL problems aggregated (not first-fail), before we waste
  //      seconds on a Postgres connection that was never configured.
  //
  //    The dry-run exits sit before every other env read (KEK decrypt,
  //    JWT secret, MFA token secrets), so a build pipeline without deploy
  //    secrets can run them.
  //
  //    Ordering invariant: this step runs BEFORE the Temporal polyfill,
  //    so env-schemas MUST use only Temporal-free Zod types. Don't author
  //    `z.iso.date()`/`Temporal.Instant` fields on env-vars — they'd crash
  //    at parse-time before the polyfill loads. Plain strings + .regex /
  //    .min / .email / .url cover every env-var shape we've actually
  //    needed in 9.1's audit (37 references, 25 distinct vars).
  const envGate = await runEnvGate(options, "runProdApp");
  if (envGate.kind === "stopped") return makeDryRunHandle();
  const { runMode, decryptedEnvSource } = envGate;
  const log = installProcessLogger(options.extraContext, "runProdApp");

  // Stacks whose boot options are missing and the declarative boot options
  // (mail, kmsMode, fileStorage, billing, demoMode, seed shortcuts) fail here, before any connection. Their defaults sit under
  // the env so an explicitly set variable wins.
  assertStackBootRequirements(options);
  const bootOptionWiring = await resolveBootOptionWiring(options, decryptedEnvSource);
  const envSource: Record<string, string | undefined> =
    Object.keys(bootOptionWiring.envDefaults).length > 0
      ? { ...bootOptionWiring.envDefaults, ...decryptedEnvSource }
      : decryptedEnvSource;
  const bootKms = bootOptionWiring.kms;

  // 1. Polyfill before anything else — feature code references Temporal.
  const { ensureTemporalPolyfill } = await import("@cosmicdrift/kumiko-framework/time");
  await ensureTemporalPolyfill();

  // 2. Env-vars: fail-fast. Better a 0s boot crash with a clear error
  //    than a 30s timeout chasing a Postgres connection that was never
  //    configured.
  const databaseUrl = requireEnv("DATABASE_URL", envSource);
  const redisUrl = requireEnv("REDIS_URL", envSource);
  // JWT_SECRET stays mandatory (also the resolveAuthMail hmacSecret
  // fallback below — a separate, non-rotating HMAC token family, not the
  // session JWT). jwtSecretOrKeyring is the OPTIONAL upgrade: set
  // JWT_SECRET_V<n> + JWT_SECRET_CURRENT_VERSION for zero-downtime
  // rotation of the session-JWT signing key — see loadJwtSecretOrKeyring.
  const jwtSecret = requireEnv("JWT_SECRET", envSource);
  const jwtSecretOrKeyring = loadJwtSecretOrKeyring(envSource);
  if (typeof jwtSecretOrKeyring === "object" && Object.hasOwn(jwtSecretOrKeyring.keys, "legacy")) {
    // Once per process — JWT_SECRET stays a required env (requireEnv above +
    // resolveAuthMail hmacSecret fallback). Retiring the *legacy verify key*
    // means setting auth.mail.hmacSecret explicitly and rotating JWT_SECRET
    // to a fresh value that is no longer in any in-flight token; unsetting
    // JWT_SECRET entirely hard-crashes boot.
    warnLegacyJwtSecretOnce();
  }
  const jwtIssuer = readEnv("JWT_ISSUER", envSource);
  const instanceId = readEnv("KUMIKO_INSTANCE_ID", envSource);
  // options.auth.trustedProxyHops wins; falls back
  // to the env var so ops can close the XFF-spoofing hole per-deployment
  // without a code change (mirrors instanceId's env-first pattern above).
  const trustedProxyHops = resolveTrustedProxyHops({
    option: options.trustedProxyHops,
    authOption: options.auth?.trustedProxyHops,
    envValue: readEnv(TRUSTED_PROXY_HOPS_ENV, envSource),
    nodeEnv: process.env["NODE_ENV"],
  });
  if (trustedProxyHops === undefined) {
    // With 0 hops every request appears to come from the proxy pod, so all IP-keyed
    // rate limiters collapse into one shared bucket behind a reverse proxy.
    log.warn(
      `trustedProxyHops / ${TRUSTED_PROXY_HOPS_ENV} is not set; client IP falls back to the socket address. ` +
        "Behind a reverse proxy all clients share one rate-limit bucket, so the default L1/L2 limits throttle the whole site at once.",
    );
  }
  const resolvedRateLimit = resolveRateLimit(options.rateLimit);
  const port = options.port ?? Number.parseInt(envSource["PORT"] ?? "3000", 10);

  log.info(`booting Kumiko stack on port ${port}`);

  // auth.mail is expanded into the explicit flow fields before feeding both
  // the feature side (buildComposeAuthOptions) and the routes fragment below.
  // From here on, always read effectiveAuth instead of options.auth.
  const effectiveAuth = options.auth
    ? resolveAuthMail(options.auth, jwtSecret, envSource, {
        mailConfigured: bootOptionWiring.mailConfigured,
      })
    : undefined;
  const authPublicOrigin = effectiveAuth
    ? resolveAuthPublicOrigin(effectiveAuth, envSource, (message) => {
        log.warn(message);
      })
    : undefined;

  const { unsubscribeLinks, unsubscribeRoutes } = resolveUnsubscribeWiring({
    unsubscribe: options.unsubscribe,
    publicOrigin: effectiveAuth?.publicOrigin,
    mailBaseUrl: effectiveAuth?.mail?.baseUrl,
    envSource,
    warn: (message) => createFallbackLogger("runProdApp").warn(message),
  });

  // 3. Feature registry. Auth mode automatically mixes config/user/tenant/
  // auth-email-password via composeFeatures, using the same feature list as
  // runDevApp and the per-app schema generator. Build it before any connection
  // so boot mode can validate wiring without opening Postgres or Redis sockets.
  const composeAuthOptions = buildComposeAuthOptions(effectiveAuth);
  const features = composeFeatures([...options.features, ...bootOptionWiring.features], {
    includeBundled: !!effectiveAuth,
    ...(composeAuthOptions && { authOptions: composeAuthOptions }),
  });

  const bootCrypto = resolveBootCrypto(envSource, options.masterKey);
  validateBoot(features, {
    env: envSource,
    ...(bootCrypto.entityFieldCipher && { entityFieldCipher: bootCrypto.entityFieldCipher }),
    ...options.validateBootOptions,
  });
  warnIfNonUtcServerTimeZone();
  validateAppCustomScreenWriteQns(process.cwd(), collectWriteHandlerQns(features));
  assertPiiBootInvariants(features, {
    kms: bootKms.kms,
    blindIndexKey: bootKms.blindIndexKey,
    allowPlaintextPii: bootKms.allowPlaintextPii,
    mode: "prod",
  });
  const sessionsFeature = features.find((f) => f.name === SESSIONS_FEATURE);
  const registry = createRegistry(features);
  assertSessionBootInvariants({
    hasAuth: Boolean(effectiveAuth),
    sessionStoreProviderMounted: registry.getExtensionUsages(EXT_SESSION_STORE).length > 0,
    mode: "prod",
  });

  // C1 boot-mode exit: validators ran + registry built; no DB/Redis client
  // is constructed at all in this branch (the eager `new Redis(...)` below
  // would otherwise open a TCP connect just to immediately disconnect it).
  if (runMode === "boot") {
    // biome-ignore lint/suspicious/noConsole: boot-mode output IS the deliverable
    console.log(
      `[runProdApp] boot validation OK (${features.length} features, ${registry.features.size} registry entries)`,
    );
    await bootKms.close();
    uninstallProcessLogger();
    if (options.envSource === undefined) {
      process.exit(0);
    }
    return makeDryRunHandle();
  }

  // 4. Connections — Postgres + Redis. The Redis client is shared by
  //    idempotency, event-dedup, entity-cache, rate-limit; failing to
  //    construct here surfaces the misconfig immediately. `new Redis(...)`
  //    connects eagerly, so it must stay AFTER the boot-mode exit above.
  // KMS health gate: an app configured for crypto-shredding must not boot
  // against an unreachable key store — a silent start would answer every
  // PII read with 503. Runs BEFORE connections so an abort leaks nothing.
  const databaseWaitDeadline = Date.now() + WAIT_FOR_DATABASE_DEADLINE_MS;
  if (bootKms.kms) {
    const kms = bootKms.kms;
    const kmsHealth = await waitUntilDatabaseReachable(() => kms.health(), {
      processName: "runProdApp",
      deadline: databaseWaitDeadline,
    });
    if (!kmsHealth.ok) {
      throw new Error(
        `[runProdApp] BOOT ABORTED — KMS health check failed (latency ${kmsHealth.latencyMs}ms)`,
      );
    }
  }

  const { db, close: closeDb } = createDbConnection({
    url: databaseUrl,
    ...dbConnectionOptionsFromEnv(envSource),
    ...serverTimeoutOptionsFromEnv(envSource),
  });
  const { db: outsideTransactionDb, close: closeOutsideTransactionDb } = createDbConnection({
    url: databaseUrl,
    ...outsideTransactionPoolOptionsFromEnv(envSource),
    ...serverTimeoutOptionsFromEnv(envSource),
  });
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: null });
  logRedisConnectionState(redis, log);

  await waitForDatabase(db, { processName: "runProdApp", deadline: databaseWaitDeadline });

  // Tier-Composition auto-wire: scan features for a
  // tenantTierResolver-extension. If found, build the resolver here (db +
  // registry are available) before the dispatcher is constructed. App-Author sees
  // nothing — `createTierEngineFeature(opts)` mounts + framework auto-wires.
  // One bus per process: the tier resolver, the dispatcher and the file-provider
  // resolver all subscribe to it (invalidation across the API pods).
  const cacheSync = createRedisCacheSyncBus({
    redisUrl,
    clientOptions: redisClientOptionsFromEnv(envSource),
  });
  let resolvedEffectiveFeatures: EffectiveFeaturesResolver | undefined;
  const tierResolverUsage = findTierResolverUsage(features);
  if (tierResolverUsage) {
    resolvedEffectiveFeatures = await requireTierResolverPlugin(tierResolverUsage).build({
      db,
      registry,
      cacheSync,
    });
  }
  if (bootOptionWiring.featureToggles) {
    const bound = await bootOptionWiring.featureToggles.bind({
      db,
      registry,
      cacheSync,
      tierResolver: resolvedEffectiveFeatures,
    });
    resolvedEffectiveFeatures = bound.resolver;
  }

  // 5. Schema-drift gate (without drizzle, using kumiko/migrations). `kumiko
  // schema apply` runs as a deploy step before container rollout. Boot only
  // verifies that every kumiko/migrations/*.sql file is applied in
  // _kumiko_migrations with an unchanged checksum and that every table in
  // kumiko/migrations/.snapshot.json exists. Drift aborts boot rather than being auto-healed, avoiding
  // races between container replicas. `migrations: false` opts out for custom
  // schema setups.
  if (options.migrations !== false) {
    const migrationsDir = options.migrations?.dir ?? "./kumiko/migrations";
    log.info(`checking schema drift (${migrationsDir})`);
    try {
      await assertKumikoSchemaCurrent(db, migrationsDir);
    } catch (err) {
      if (err instanceof SchemaDriftError) {
        log.error(`BOOT ABORTED — ${err.message}`);
      }
      throw err;
    }
  }

  // 6. Pipeline pieces — same default config as runDevApp's setupTestStack.
  const idempotency = createIdempotencyGuard(redis, { ttlSeconds: 60 });
  const eventDedup = createEventDedup(redis, { ttlSeconds: 60 });
  const entityCache = createEntityCache(redis, { ttlSeconds: 60 });

  // 7. When no lifecycle is supplied, createApiEntrypoint builds and owns it;
  // the handle exposes it for SIGTERM.
  //
  // extraContext and anonymousAccess accept either an object or a factory that
  // receives {db, redis, registry}; factories are useful when boot-time database
  // access is needed, such as a subdomain-to-tenant resolver.
  //
  // Build the SSE broker here so extraContext factories can close over it, and
  // pass the same broker into createApiEntrypoint (sseBroker option) so
  // server-internal broadcasts and app-specific publishes share one broker. Use
  // createDefaultSseBroker so REDIS_URL selects a Redis-backed broker; an
  // unconditional in-memory broker would silently override buildServer's
  // Redis-backed default (ServerOptions.sseBroker always wins) and prevent
  // cross-replica fanout.
  const { sseBroker, ownedRedisSseBroker } = createDefaultSseBroker(envSource);
  const deps: RunProdAppDeps = {
    db,
    redis,
    registry,
    sseBroker,
    env: envSource,
    ...(bootCrypto.masterKeyProvider && { masterKeyProvider: bootCrypto.masterKeyProvider }),
    ...(bootCrypto.configCipher && { configEncryption: bootCrypto.configCipher }),
  };
  const resolvedExtraContext =
    typeof options.extraContext === "function"
      ? options.extraContext(deps)
      : (options.extraContext ?? {});

  // Install framework defaults first; app values in resolvedExtraContext always
  // win (for example, an app-specific configResolver).
  // The app-wide cipher is resolved lazily, so entities without encrypted
  // fields never access it.
  configureEntityFieldEncryption(bootCrypto.entityFieldCipher);
  // Subject-key KMS for pii-annotated fields (crypto-shredding).
  // No adapter only gets this far when assertPiiBootInvariants above let it
  // through: no PII carriers, or an explicit allowPlaintextPii opt-out. The
  // engine then stays off and those fields are stored in plaintext.
  configurePiiSubjectKms(bootKms.kms);
  // Blind-index key boot gate: with KMS enabled, lookupable fields are stored as
  // ciphertext. Without the key, equality lookups such as login by email cannot
  // work, so fail fast rather than allowing silently broken authentication.
  configureBlindIndexKey(bootKms.blindIndexKey);
  const bootLogger = loggerFromExtraContext(resolvedExtraContext);
  if (bootLogger) setProcessLogger(bootLogger);
  const autoExtraContext = buildBootExtraContext({
    db,
    features,
    envSource,
    registry,
    hasAuth: !!effectiveAuth,
    sseBroker,
    redis,
    crypto: bootCrypto,
    ...(bootKms.kms && { kms: bootKms.kms }),
    ...(bootLogger && { log: bootLogger }),
    ...(unsubscribeLinks && { unsubscribeLinks }),
    ...(options.appOverrides && { appOverrides: options.appOverrides }),
  });
  const extraContext = {
    ...addConfigAccessorFactory({ ...autoExtraContext, ...resolvedExtraContext }, registry),
    ...(options.defaultLocale !== undefined && { defaultLocale: options.defaultLocale }),
  };
  const baseAnonymousAccess =
    typeof options.anonymousAccess === "function"
      ? options.anonymousAccess(deps)
      : options.anonymousAccess;
  // tenantResolver / tenantExists come from auth-foundation providers.
  const resolvedAnonymousAccess = await resolveAnonymousAccessFromRegistry(baseAnonymousAccess, {
    db,
    registry,
    warn: (message) => createFallbackLogger("runProdApp").warn(message),
  });

  // Sessions are wired directly because db has already been created; unlike
  // runDevApp, no late binding is needed. Once a sessionChecker is wired, JWTs
  // without sid are rejected, so production sessions cannot be bypassed.
  // sessionMassRevoker (the fourth callback from createSessionCallbacks) is not
  // part of AuthRoutesConfig; bindAutoRevokeFromFeature hands it to the sessions
  // feature so password change and reset revoke all sessions. Secure by default: the sessionStore provider
  // goes through resolveSessionStore.
  const mfaFeature = features.find((f) => f.name === AUTH_MFA_FEATURE);
  if (mfaFeature) bindMfaTokenSecretsFromFeature(mfaFeature)?.(jwtSecret, envSource);
  if (mfaFeature && registry.getWriteHandler(AuthHandlers.switchTenantMfaGate) === undefined) {
    throw new Error(
      `[runProdApp] auth-mfa is mounted but ${AuthHandlers.switchTenantMfaGate} is not registered: ` +
        "createAuthEmailPasswordFeature registers it only when mfaStatusChecker is set, and without it " +
        "POST /auth/switch-tenant would mint sessions without the second factor",
    );
  }
  // Hoisted above buildProdSessionAuth: that call also wires MFA-enable/
  // disable → PAT-revoke (bindRevokeAllPatTokensFromFeature), so it needs
  // patFeature too.
  const patFeature = features.find((f) => f.name === PAT_FEATURE);
  const sessionAuthFragment = shouldWireProdSessions(
    Boolean(effectiveAuth),
    registry.getExtensionUsages(EXT_SESSION_STORE).length > 0,
  )
    ? await buildProdSessionAuth(db, registry, sessionsFeature, mfaFeature, patFeature)
    : undefined;

  // Password-change → PAT-revoke: independent of sessions/MFA being mounted
  // (buildProdSessionAuth only runs when a sessionStore provider is
  // registered), so wired unconditionally here whenever PAT itself is.
  if (patFeature) {
    wireProdPatAutoRevoke(db, patFeature);
  }

  // Token-verifier opt-in: any provider feature (personal-access-tokens, a
  // future auth-provider-jwt, ...) self-registers via
  // r.useExtension(EXT_TOKEN_VERIFIER, ...) — wire one generic resolver
  // whenever at least one is mounted, resolved by shape at request-time.
  // PAT keeps its own per-token rate limiter (patRateLimiter), unrelated to
  // verification.
  const hasTokenVerifierProviders = registry.getExtensionUsages(EXT_TOKEN_VERIFIER).length > 0;
  let patAuthFragment:
    | {
        tokenVerifier: TokenVerifier;
        patRateLimiter: LoginRateLimiter;
      }
    | undefined;
  if (effectiveAuth && patFeature && hasTokenVerifierProviders) {
    const rl = patRateLimitFromFeature(patFeature);
    patAuthFragment = {
      tokenVerifier: (rawToken) => resolveTokenVerifier({ db, registry }, rawToken),
      patRateLimiter: createRedisLoginRateLimiter(redis, rl.maxRequests, rl.windowMs, "pat"),
    };
  }

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
    jwtSecret: jwtSecretOrKeyring,
    ...(jwtIssuer && { jwtIssuer }),
    ...(instanceId && { instanceId }),
    dispatcherOptions: {
      idempotency,
      cacheSync,
      outsideTransactionDb,
      ...(resolvedEffectiveFeatures && { effectiveFeatures: resolvedEffectiveFeatures }),
    },
    eventDedup,
    ...(options.observability && { observability: options.observability }),
    ...(options.metrics && { metrics: options.metrics }),
    ...(resolvedRateLimit && { rateLimit: resolvedRateLimit }),
    ...(trustedProxyHops !== undefined && { trustedProxyHops }),
    ...(options.errorDocs && { errorDocs: options.errorDocs }),
    ...((options.extraRoutes || options.unsubscribe || bootOptionWiring.extraRoutes.length > 0) && {
      extraRoutes: [
        ...(options.extraRoutes ?? []),
        ...unsubscribeRoutes,
        ...bootOptionWiring.extraRoutes,
      ],
    }),
    ...(effectiveAuth && {
      auth: {
        membershipQuery: TenantQueries.memberships,
        userQuery: UserQueries.findForAuth,
        loginHandler: AuthHandlers.login,
        loginErrorStatusMap: effectiveAuth.loginErrorStatusMap ?? {
          [AuthErrors.invalidCredentials]: 401,
          [AuthErrors.noMembership]: 403,
        },
        // Redis-backed, not the in-memory default createAuthRoutes falls
        // back to — an in-process limiter only rate-limits within a single
        // replica, so a multi-instance prod deployment would silently give
        // each replica its own bucket. Redis is required infra
        // here already (REDIS_URL), so this is free.
        loginRateLimit: createRedisLoginRateLimiter(redis),
        ...(effectiveAuth.cookieDomain !== undefined && {
          cookieDomain: effectiveAuth.cookieDomain,
        }),
        ...(effectiveAuth.secureCookies !== undefined && {
          secureCookies: effectiveAuth.secureCookies,
        }),
        ...(effectiveAuth.retiredCookieDomains !== undefined && {
          retiredCookieDomains: effectiveAuth.retiredCookieDomains,
        }),
        ...(effectiveAuth.allowedOrigins !== undefined && {
          allowedOrigins: effectiveAuth.allowedOrigins,
        }),
        ...(effectiveAuth.unsafeSkipOriginCheck !== undefined && {
          unsafeSkipOriginCheck: effectiveAuth.unsafeSkipOriginCheck,
        }),
        ...(authPublicOrigin !== undefined && { publicOrigin: authPublicOrigin }),
        ...(trustedProxyHops !== undefined && { trustedProxyHops }),
        ...(effectiveAuth.postAuthLanding !== undefined && {
          postAuthLanding: effectiveAuth.postAuthLanding,
        }),
        ...sessionAuthFragment,
        ...patAuthFragment,
        ...(mfaFeature && {
          mfaVerifyHandler: AuthMfaHandlers.verify,
          switchTenantMfaGateHandler: AuthHandlers.switchTenantMfaGate,
          mfaPreauthEnableStartHandler: AuthMfaHandlers.enableStartPreauth,
          mfaPreauthConfirmHandler: AuthMfaHandlers.enableConfirmPreauth,
          mfaVerifyRateLimit: createRedisLoginRateLimiter(
            redis,
            undefined,
            undefined,
            "mfa-verify",
          ),
          mfaPreauthEnableStartRateLimit: createRedisLoginRateLimiter(
            redis,
            undefined,
            undefined,
            "mfa-preauth-start",
          ),
          mfaPreauthConfirmRateLimit: createRedisLoginRateLimiter(
            redis,
            undefined,
            undefined,
            "mfa-preauth-confirm",
          ),
        }),
        ...(effectiveAuth.passwordReset && {
          passwordReset: {
            requestHandler: AuthHandlers.requestPasswordReset,
            confirmHandler: AuthHandlers.resetPassword,
          },
        }),
        ...(effectiveAuth.emailVerification && {
          emailVerification: {
            requestHandler: AuthHandlers.requestEmailVerification,
            confirmHandler: AuthHandlers.verifyEmail,
          },
        }),
        ...(effectiveAuth.accountUnlock && {
          accountUnlock: {
            requestHandler: AuthHandlers.requestAccountUnlock,
            confirmHandler: AuthHandlers.confirmAccountUnlock,
          },
        }),
        ...(effectiveAuth.signup && {
          signup: {
            requestHandler: AuthHandlers.signupRequest,
            confirmHandler: AuthHandlers.signupConfirm,
          },
        }),
        ...(effectiveAuth.invite && {
          invite: {
            acceptHandler: AuthHandlers.inviteAccept,
            acceptWithLoginHandler: AuthHandlers.inviteAcceptWithLogin,
            signupCompleteHandler: AuthHandlers.inviteSignupComplete,
            infoHandler: AuthQueries.inviteInfo,
          },
        }),
      },
    }),
    ...(resolvedAnonymousAccess && { anonymousAccess: resolvedAnonymousAccess }),
  };

  // Deployment topology. By default, createAllInOneEntrypoint runs HTTP, both
  // job lanes (two runners, each scheduling only its own lane's crons, so
  // nothing fires twice) and the event dispatcher inline. That way worker-lane
  // crons (run-export-jobs defaults to runIn:"worker") and MSPs run without a
  // separate worker process, the gap the data export used to stall on.
  // runSingleInstance:false means API-only: a dedicated worker must then take
  // over the worker lane and MSPs, while API-lane jobs keep running locally.
  // The legacy eventDispatcher.disabled maps to runSingleInstance:false so
  // existing callers keep working; the explicit flag takes precedence.
  const runSingleInstance = options.runSingleInstance ?? options.eventDispatcher?.disabled !== true;
  const hasJobs = registry.getAllJobs().size > 0;
  const queueNamePrefix = options.jobs?.queueNamePrefix;
  const jobLogger = jobRunLoggerCallbacks(registry, db);
  const dispatcherTunables =
    options.eventDispatcher?.pollIntervalMs !== undefined
      ? { pollIntervalMs: options.eventDispatcher.pollIntervalMs }
      : {};

  const entrypoint: ApiEntrypoint | AllInOneEntrypoint = runSingleInstance
    ? createAllInOneEntrypoint({
        ...baseEntrypointOptions,
        redisUrl,
        ...jobLogger,
        ...(queueNamePrefix !== undefined && { queueNamePrefix }),
        ...(options.jobs?.getActiveTenantIds !== undefined && {
          getActiveTenantIds: options.jobs.getActiveTenantIds,
        }),
        ...(!options.eventDispatcher?.disabled && { eventDispatcher: dispatcherTunables }),
      })
    : createApiEntrypoint({
        ...baseEntrypointOptions,
        ...(hasJobs && {
          jobs: {
            redisUrl,
            runLocalJobs: true,
            ...jobLogger,
            ...(queueNamePrefix !== undefined && { queueNamePrefix }),
            ...(options.jobs?.getActiveTenantIds !== undefined && {
              getActiveTenantIds: options.jobs.getActiveTenantIds,
            }),
          },
        }),
      });

  // The broker built above is always ours (runProdApp never accepts a
  // caller-supplied sseBroker), so — same reasoning as buildServer's own
  // ownedRedisSseBroker hook — closing it on shutdown is our job, not the
  // entrypoint's. Registered after createApiEntrypoint/createAllInOneEntrypoint
  // (which already registered the eventDispatcher/jobRunner hooks above),
  // so it drains LIFO before those, matching the close-before-teardown
  // order established for buildServer's own hook.
  entrypoint.lifecycle.registerShutdownHook("prodAppCacheSync", async () => {
    await cacheSync.close();
  });
  if (ownedRedisSseBroker) {
    const broker = ownedRedisSseBroker;
    entrypoint.lifecycle.registerShutdownHook("prodAppRedisSseBroker", async () => {
      await broker.close();
    });
  }

  // `extraRoutes` itself is already mounted — buildServer wires it inside
  // createApiEntrypoint/createAllInOneEntrypoint, before this function ever
  // runs. `wire` is the remaining escape-hatch for app-wired co-running
  // components that need the system-write dispatcher but don't declare a
  // route.
  if (options.wire) {
    await options.wire({
      db,
      redis,
      registry,
      ...(bootCrypto.masterKeyProvider && { masterKeyProvider: bootCrypto.masterKeyProvider }),
      ...(bootCrypto.configCipher && { configEncryption: bootCrypto.configCipher }),
      metricsFor: createMetricsForFactory(entrypoint.observability.meter),
      dispatchSystemWrite: makeDispatchSystemWrite(entrypoint.dispatcher),
      dispatchSystemQuery: makeDispatchSystemQuery(entrypoint.dispatcher),
    });
  }

  // 9. Seeds: admin first, then config-seeds from r.config({seeds}),
  //    then app-specific. All idempotent — runProdApp doesn't gate
  //    "first boot" via flag, every seed-step checks its own
  //    preconditions. Config-seeds rely on a deterministic
  //    aggregate-id so re-boot becomes a version_conflict skip.
  if (effectiveAuth?.admin) {
    await seedAdminGuarded(db, effectiveAuth.admin);
  }
  for (const seed of bootOptionWiring.shortcutSeeds) {
    await seed(db);
  }
  await applyBootSeeds({
    registry,
    db,
    ...(bootCrypto.configCipher && { cipher: bootCrypto.configCipher }),
  });
  const customSeeds = bootOptionWiring.customSeeds;
  const hasSeeds = customSeeds.length > 0 || options.seedsDir !== undefined;
  // Seeds are bootstrap writes, not tenant traffic: they always get the unlimited resolver,
  // even when the app has a real one, so a handler's rateLimit can neither fail nor drain them.
  const seedContext = hasSeeds
    ? withFileProviderResolver(
        registry,
        {
          db,
          redis,
          entityCache,
          registry,
          ...extraContext,
          rateLimit: createUnlimitedRateLimitResolver(),
        },
        cacheSync,
      )
    : undefined;
  const seedDispatcher = seedContext
    ? withSeedErrorContext(
        createDispatcher(registry, seedContext, {
          ...baseEntrypointOptions.dispatcherOptions,
          ...(entrypoint.mode === "all-in-one" && { jobRunner: entrypoint.jobRunner }),
        }),
      )
    : undefined;
  if (seedDispatcher && seedContext) {
    const createFileRef = makeSeedCreateFileRef({ db, registry, context: seedContext });
    for (const seed of customSeeds) {
      await seed({
        db,
        registry,
        dispatcher: seedDispatcher,
        createFileRef,
        ...(bootCrypto.masterKeyProvider && { masterKeyProvider: bootCrypto.masterKeyProvider }),
        ...(bootCrypto.configCipher && { configEncryption: bootCrypto.configCipher }),
      });
    }
  }

  // ES operations and seed migrations run after applyBootSeeds and the existing
  // seeds array. Declarative seeds insert missing records; seed migrations
  // diff and update state that existing seeds cannot revise, such as membership
  // roles changed after initial seed creation.
  if (seedDispatcher && options.seedsDir !== undefined && envSource["KUMIKO_SKIP_ES_OPS"] !== "1") {
    await createEsOperationsTable(db);
    await runPendingSeedMigrations({
      db,
      seedsDir: options.seedsDir,
      appliedBy: "boot",
      registry, // The dry-run validator catches handler QN typos before writing.
      // @wrapper-known semantic-alias
      createContext: (dbRunner: DbRunner) =>
        createSeedMigrationContext({ dispatcher: seedDispatcher, dbRunner }),
    });
  }

  await entrypoint.start();
  await recordAppStartedOnBoot({ db, envSource });
  startPiiEventBackfillOnBoot({
    db,
    registry,
    lifecycle: entrypoint.lifecycle,
    envSource,
  });

  // 11. Build the fetch-handler. Static-fallback for non-/api/ paths
  //     wired via a wrapper so Hono owns /api/* + extraRoutes and disk
  //     owns the rest. Tests use this directly; listen() wraps it in
  //     Bun.serve.
  const cspScriptHashes = await resolveCspScriptHashes(options.staticDir, options.securityHeaders);
  const hostDispatchScriptHashes =
    options.hostDispatch !== undefined && options.staticDir !== undefined
      ? await resolveHostDispatchScriptHashes(
          options.staticDir,
          options.securityHeaders,
          cspScriptHashes,
        )
      : [];
  const fetchHandler = withSecurityHeaders(
    bootOptionWiring.wrapFetch(
      options.staticDir
        ? buildStaticFallback(
            entrypoint.app.fetch.bind(entrypoint.app),
            options.staticDir,
            options.hostDispatch,
            options.resolvePageHead
              ? { resolvePageHead: options.resolvePageHead, dispatcher: entrypoint.dispatcher }
              : undefined,
            entrypoint.dispatcher,
            trustedProxyHops ?? 0,
            hostDispatchScriptHashes,
          )
        : // No staticDir (split-deploy / API-only container) → app.fetch's
          // response goes straight to the client, bypassing buildStaticFallback
          // (and with it tryHonoFirst) entirely. Must strip the router-miss
          // marker here too, same reason as the /api/* passthrough in
          // run-prod-app-static-files.ts (see try-hono-first.ts).
          async (req: Request, socketAddress?: string) =>
            stripNoRouteMatchHeader(await entrypoint.app.fetch(req, socketAddress)),
    ),
    options.securityHeaders,
    cspScriptHashes,
  );

  // 11. Mark lifecycle ready — health/ready flips to 200 after this.
  entrypoint.lifecycle.markReady();

  // Upgrade rejections (401/403/426...) are ordinary responses and get the same headers as fetchHandler.
  const securedUpgradeFetch = withSecurityHeaders<KumikoServeEnv>(
    async (req, env) => stripNoRouteMatchHeader(await entrypoint.app.fetch(req, env)),
    options.securityHeaders,
    cspScriptHashes,
  );
  const webSocketUpgradeFetch = async (req: Request, env: KumikoServeEnv): Promise<Response> =>
    securedUpgradeFetch(req, env);

  let uninstallShutdownSignals: (() => void) | undefined;
  let uninstallFatalHandlers: (() => void) | undefined;
  const handle: ProdAppHandle = {
    entrypoint,
    fetch: fetchHandler,
    webSocketUpgradeFetch,
    listen: async (listenPort = port) => {
      // Bun.serve provides production HTTP. Tests run under Node, so they call the
      // fetch handler directly instead. buildBunServeOptions centralizes the
      // options shape, including `idleTimeout: 0` for SSE.
      if (typeof Bun === "undefined") {
        // Throw a clear error instead of a raw ReferenceError when listen() is called
        // under Node/vitest without autoListen:false, making the runtime
        // requirement explicit.
        throw new Error(
          "[runProdApp] listen() requires Bun runtime (Bun.serve). " +
            "Under Node/vitest pass `autoListen: false` and call the returned `fetch()` directly.",
        );
      }
      handle.server = Bun.serve(
        buildBunServeOptions(
          listenPort,
          fetchHandler,
          options.maxRequestBodySize ?? resolveDerivedMaxRequestBodySize(registry),
          { upgradeFetch: webSocketUpgradeFetch },
        ),
      );

      // SIGTERM/SIGINT — graceful shutdown. Only registered when we
      // actually own a Bun-server, otherwise the test process picks up
      // signals it shouldn't respond to.
      if (options.signals !== false) {
        uninstallShutdownSignals?.();
        uninstallShutdownSignals = installShutdownSignals({
          stop: () => handle.stop(),
          ...(options.signals?.drainTimeoutMs !== undefined && {
            drainTimeoutMs: options.signals.drainTimeoutMs,
          }),
        });
        uninstallFatalHandlers?.();
        uninstallFatalHandlers = installFatalErrorHandlers({
          logger: log,
          stop: () => handle.stop(),
        });
      }

      log.info(`ready on http://0.0.0.0:${listenPort}`);
    },
    stop: async () => {
      uninstallFatalHandlers?.();
      uninstallFatalHandlers = undefined;
      await entrypoint.stop();
      if (handle.server) await stopServerGracefully(handle.server);
      await flushEscapeHatchAudits();
      await closeDb();
      await closeOutsideTransactionDb();
      redis.disconnect();
      await bootKms.close();
      uninstallShutdownSignals?.();
      uninstallShutdownSignals = undefined;
      uninstallProcessLogger();
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
