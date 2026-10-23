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

import type {
  AccountLockoutOptions,
  AccountUnlockOptions,
  AuthMailLocale,
  AuthPaths,
  EmailVerificationOptions,
  InviteOptions,
  PasswordResetOptions,
  SignupOptions,
} from "@cosmicdrift/kumiko-bundled-features/auth-email-password";
import type { SeedAdminOptions } from "@cosmicdrift/kumiko-bundled-features/auth-email-password/seeding";
import type {
  ExtraRouteDefinition,
  KumikoServeEnv,
  PostAuthLandingResolver,
  SseBroker,
} from "@cosmicdrift/kumiko-framework/api";
import type { KmsAdapter } from "@cosmicdrift/kumiko-framework/crypto";
import {
  assertRowLevelSecurityBootState,
  type RowLevelSecurityMode,
} from "@cosmicdrift/kumiko-framework/db";
import type {
  BundledListsOptions,
  FeatureDefinition,
  ValidateBootOptions,
} from "@cosmicdrift/kumiko-framework/engine";
import type { AllInOneEntrypoint, ApiEntrypoint } from "@cosmicdrift/kumiko-framework/entrypoint";
import type { ComposedEnvSchema, KumikoBootError } from "@cosmicdrift/kumiko-framework/env";
import type { ErrorDocsConfig } from "@cosmicdrift/kumiko-framework/errors";
import { assertSeedModeNotInProduction } from "@cosmicdrift/kumiko-framework/event-store";
import type { JobRunnerOptions } from "@cosmicdrift/kumiko-framework/jobs";
import type { ObservabilityProvider } from "@cosmicdrift/kumiko-framework/observability";
import type { MasterKeyProvider } from "@cosmicdrift/kumiko-framework/secrets";
import type {
  PageHeadMeta,
  PageHeadResolver,
  PageHeadSystemQuery,
} from "@cosmicdrift/kumiko-renderer/headless/apex";
import type { Redis } from "ioredis";
import { runEnvGate } from "./boot/env-gate.ts";
import { buildEffectiveFeaturesResolver } from "./boot/shared-boot-steps.ts";
import type { DatabaseWaitClock } from "./boot/wait-for-database.ts";
import { warnIfRowLevelSecurityOff } from "./boot/warn-row-level-security-off.ts";
import type { BillingBootOption } from "./boot-options/billing-option.ts";
import type { DemoModeOption } from "./boot-options/demo-mode.ts";
import type { FileStorageBootOption } from "./boot-options/file-storage-option.ts";
import type { KmsMode } from "./boot-options/kms-mode.ts";
import type { MailBootOption } from "./boot-options/mail-option.ts";
import type { SignalsOption } from "./boot-options/process-signals.ts";
import type { ProdSeedsConfig } from "./boot-options/seed-shortcuts.ts";
import type { SystemWireDeps } from "./extra-routes-deps.ts";
import { installProcessLogger, uninstallProcessLogger } from "./process-logger.ts";
import type { RateLimitOption } from "./rate-limit-defaults.ts";
import type { UnsubscribeOption } from "./resolve-unsubscribe-wiring.ts";
import { wireProdAuth } from "./run-prod-app-auth.ts";
import type { ConfigOverridesInput } from "./run-prod-app-boot-context.ts";
import {
  composeProdFeatures,
  type RegisterBootAbortCleanup,
  resolveProdBootConfig,
  runWithBootAbortCleanups,
} from "./run-prod-app-config.ts";
import { assertProdSchemaCurrent, connectProdDependencies } from "./run-prod-app-connections.ts";
import {
  buildProdEntrypointOptions,
  createProdEntrypoint,
  registerProdShutdownHooks,
  runProdWireHook,
  startProdBackgroundWork,
} from "./run-prod-app-entrypoint.ts";
import { buildProdFetchHandler, createProdAppHandle } from "./run-prod-app-handle.ts";
import { buildProdRequestContext } from "./run-prod-app-request-context.ts";
import { runProdBootSeeds } from "./run-prod-app-seeds.ts";
import type { SecurityHeadersOption } from "./security-headers.ts";
import type { SeedCreateFileRef } from "./seed-dispatcher.ts";

export { parseRunMode } from "./boot/env-gate.ts";
export { buildBunServeOptions } from "./bun-serve-options.ts";
export { requireEnv } from "./require-env.ts";
export {
  resolveUnsubscribeWiring,
  type UnsubscribeOption,
} from "./resolve-unsubscribe-wiring.ts";
export {
  addConfigAccessorFactory,
  buildBootExtraContext,
  buildConfigOverrides,
  type ConfigOverridesInput,
  loggerFromExtraContext,
  resolveAuthMail,
} from "./run-prod-app-boot-context.ts";
export { staticCachePolicy } from "./run-prod-app-static-files.ts";

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
  /** One table block for every list of the bundled features, see ComposeFeaturesOptions.bundledLists. */
  readonly bundledLists?: BundledListsOptions;
  /** Row level security mode of every connection; pass `appConfig.rowLevelSecurity`. Default "on". */
  readonly rowLevelSecurity?: RowLevelSecurityMode;
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
  /** Replaces the real clock, sleep and log sink of the boot backoff for the database, KMS and
   *  seed waits; tests use it to run the retry path without real waiting. */
  readonly databaseWait?: DatabaseWaitClock;
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
  /** Billing: `subscription-stripe` and/or `subscription-dodo` plus one tier-syncing webhook
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
   *  its own subdomain or custom domain (the host must serve this app's `/api` routes, and
   *  the callback must only return a verified, active domain, else null: the link carries a bearer
   *  token a stale domain's new owner would receive); null,
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

export async function runProdApp(options: RunProdAppOptions): Promise<ProdAppHandle> {
  return runWithBootAbortCleanups((register) => bootProdApp(options, register));
}

async function bootProdApp(
  options: RunProdAppOptions,
  registerAbortCleanup: RegisterBootAbortCleanup,
): Promise<ProdAppHandle> {
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

  const config = await resolveProdBootConfig(
    options,
    decryptedEnvSource,
    log,
    registerAbortCleanup,
  );
  const composed = composeProdFeatures(options, config, log);
  const { bootKms } = config;
  const { features, registry } = composed;

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

  const connections = await connectProdDependencies(
    config,
    log,
    registerAbortCleanup,
    options.databaseWait,
  );
  // Tier-composition auto-wire: if a feature carries a tenantTierResolver extension, the
  // resolver is built here, before the dispatcher exists. The app author only mounts
  // `createTierEngineFeature(opts)`; the framework does the wiring.
  const effectiveFeatures = await buildEffectiveFeaturesResolver({
    features,
    featureToggles: config.bootOptionWiring.featureToggles,
    db: connections.db,
    registry,
    cacheSync: connections.cacheSync,
  });
  await assertProdSchemaCurrent(connections.db, options.migrations, log);
  await assertRowLevelSecurityBootState(connections.db, config.rowLevelSecurity);
  warnIfRowLevelSecurityOff(config.rowLevelSecurity, log);

  const requestContext = await buildProdRequestContext(options, config, composed, connections);
  const authWiring = await wireProdAuth(config, composed, connections);
  const entrypointOptions = buildProdEntrypointOptions(
    options,
    config,
    composed,
    connections,
    requestContext,
    authWiring,
    effectiveFeatures,
  );
  const entrypoint = createProdEntrypoint(
    options,
    config,
    composed,
    connections,
    entrypointOptions,
  );
  registerProdShutdownHooks(entrypoint, connections.cacheSync, requestContext.ownedRedisSseBroker);
  await runProdWireHook(options, config, composed, connections, entrypoint);
  await runProdBootSeeds(
    { options, config, composed, connections, requestContext },
    entrypoint,
    entrypointOptions.dispatcherOptions,
  );
  await startProdBackgroundWork(entrypoint, config, composed, connections);

  const fetch = await buildProdFetchHandler(options, config, entrypoint);

  // Mark lifecycle ready — health/ready flips to 200 after this.
  entrypoint.lifecycle.markReady();

  const handle = createProdAppHandle({
    options,
    config,
    composed,
    connections,
    entrypoint,
    fetch,
    log,
  });

  // Auto-listen unless explicitly suppressed (tests pass autoListen:
  // false because Bun.serve isn't available under vitest/node).
  // Production path: `await runProdApp({...})` and the server is up.
  if (options.autoListen !== false) {
    await handle.listen();
  }

  return handle;
}
