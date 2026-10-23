// High-level dev-server wrapper for sample apps and showcases. In auth mode it
// mixes in the standard features (config/user/tenant/auth-email-password),
// wires AuthRoutesConfig plus the login error map, and calls seedAdminGuarded()
// in onAfterSetup, reducing a sample bootstrap from roughly 50 lines to 5–10.
//
// Auto-mixing occurs only in auth mode. Without an `auth` block, the server
// remains in auto-mint-JWT mode (the dev default) and adds none of these
// features. Showcases that demonstrate a single domain without a login flow
// therefore do not unexpectedly gain four additional registry features.
//
// For maximum control, such as custom auth wiring, a different membership
// query, or a custom LoginRateLimiter, use `createKumikoServer` directly from
// @cosmicdrift/kumiko-dev-server.

import type { SeedAdminOptions } from "@cosmicdrift/kumiko-bundled-features/auth-email-password/seeding";
import { createConfigResolver } from "@cosmicdrift/kumiko-bundled-features/config";
import type { PostAuthLandingResolver } from "@cosmicdrift/kumiko-framework/api";
import {
  parseTrustedProxyHopsEnv,
  TRUSTED_PROXY_HOPS_ENV,
} from "@cosmicdrift/kumiko-framework/api";
import type { KmsAdapter } from "@cosmicdrift/kumiko-framework/crypto";
import type { RowLevelSecurityMode } from "@cosmicdrift/kumiko-framework/db";
import {
  type BundledListsOptions,
  type FeatureDefinition,
  findTierResolverUsage,
  type Registry,
  type ValidateBootOptions,
} from "@cosmicdrift/kumiko-framework/engine";
import type { ComposedEnvSchema } from "@cosmicdrift/kumiko-framework/env";
import type { ErrorDocsConfig } from "@cosmicdrift/kumiko-framework/errors";
import type { EnvelopeCipher, MasterKeyProvider } from "@cosmicdrift/kumiko-framework/secrets";
import type { PageHeadResolver } from "@cosmicdrift/kumiko-renderer/headless/apex";
import type {
  BillingBootOption,
  DemoModeOption,
  FileStorageBootOption,
  KmsMode,
  MailBootOption,
  ProdSeedsConfig,
} from "@cosmicdrift/kumiko-server-runtime";
import type { resolveBootCrypto } from "@cosmicdrift/kumiko-server-runtime/boot/boot-crypto";
import type { TestStack } from "@cosmicdrift/kumiko-testing/stack";
import {
  type CreateKumikoServerOptions,
  createKumikoServer,
  type KumikoServerHandle,
} from "./create-kumiko-server.ts";
import {
  createDevLateBindings,
  createLateBoundEffectiveFeatures,
  runDevAfterSetup,
  wireDevAuth,
} from "./run-dev-app-auth.ts";
import {
  type BootFailureCleanup,
  configureDevBootCrypto,
  type DevBootConfig,
  resolveDevAuthRegistry,
  resolveDevBootConfig,
  validateDevBoot,
} from "./run-dev-app-config.ts";
import { buildDevServerOptions } from "./run-dev-app-server-options.ts";
import { renderWelcomeBanner } from "./welcome-banner.ts";

// Re-exports the shared auth setup types so apps need only one import path.
// PasswordResetSetup and EmailVerificationSetup live in
// @cosmicdrift/kumiko-server-runtime (the single source of truth) and are
// only forwarded here.
export type {
  AccountLockoutSetup,
  AccountUnlockSetup,
  AuthMailOptions,
  EmailVerificationSetup,
  InviteSetup,
  PasswordResetSetup,
  SignupSetup,
} from "@cosmicdrift/kumiko-server-runtime/run-prod-app";

import type {
  AccountLockoutSetup,
  AccountUnlockSetup,
  AuthMailOptions,
  EmailVerificationSetup,
  InviteSetup,
  PasswordResetSetup,
  SignupSetup,
} from "@cosmicdrift/kumiko-server-runtime/run-prod-app";
import {
  addConfigAccessorFactory,
  buildBootExtraContext,
  buildConfigOverrides,
  type ConfigOverridesInput,
  loggerFromExtraContext,
  type UnsubscribeOption,
} from "@cosmicdrift/kumiko-server-runtime/run-prod-app";

export type RunDevAppAuthOptions = {
  /** Admin user to seed at boot. Idempotent — re-runs in persistent-DB
   *  mode reuse the existing user. */
  readonly admin: SeedAdminOptions;
  /** Optional override of the login error → HTTP status map. Default
   *  maps invalidCredentials → 401, noMembership → 403. */
  readonly loginErrorStatusMap?: Readonly<Record<string, number>>;
  /** Auth-mail convenience, symmetric with RunProdAppAuthOptions.mail.
   *  Wires all four mail flows from env-based SMTP settings and the default
   *  templates; hmacSecret is the `JWT_SECRET` environment value, with a dev
   *  fallback when unset. Without `SMTP_HOST`, the flows remain unwired
   *  (the null-transport guard). Explicit flow setups override the mail default. */
  readonly mail?: AuthMailOptions;
  /** Password-reset flow. When set, mounts /api/auth/request-password-
   *  reset and /api/auth/reset-password as public routes and registers the
   *  request/confirm handlers in the auth-email-password feature. Symmetric
   *  with RunProdAppAuthOptions.passwordReset. */
  readonly passwordReset?: PasswordResetSetup;
  /** Email-verification flow. Symmetric to passwordReset. */
  readonly emailVerification?: EmailVerificationSetup;
  /** Self-signup flow (magic link). Symmetric to RunProdAppAuthOptions. */
  readonly signup?: SignupSetup;
  /** Tenant-invite flow (magic link). Symmetric. */
  readonly invite?: InviteSetup;
  /** Account-unlock flow. Symmetric to RunProdAppAuthOptions. */
  readonly accountUnlock?: AccountUnlockSetup;
  /** Brute-force guard on the login handler (maxFailedAttempts,
   *  lockoutDurationMinutes). Mounts no routes. Symmetric to
   *  RunProdAppAuthOptions.accountLockout. */
  readonly accountLockout?: AccountLockoutSetup;
  /** Domain attribute for both auth cookies (see
   *  AuthRoutesConfig.cookieDomain). Symmetric to RunProdAppAuthOptions. */
  readonly cookieDomain?: string;
  /** Former cookie domains cleared on login/logout (see
   *  AuthRoutesConfig.retiredCookieDomains). */
  readonly retiredCookieDomains?: readonly string[];
  /** Server-side Origin allowlist for the CSRF guard (see
   *  AuthRoutesConfig.allowedOrigins). Symmetric to RunProdAppAuthOptions —
   *  required once `cookieDomain` is set. */
  readonly allowedOrigins?: readonly string[];
  /** Opt out of the Origin guard. Symmetric to RunProdAppAuthOptions. */
  readonly unsafeSkipOriginCheck?: boolean;
  /** Number of trusted reverse-proxy hops for client-IP derivation (see
   *  AuthRoutesConfig.trustedProxyHops). Symmetric to
   *  RunProdAppAuthOptions — dev usually runs unproxied, so this is normally
   *  left unset (default 0). */
  readonly trustedProxyHops?: number;
  /** Server-computed post-auth redirect (see AuthRoutesConfig.postAuthLanding).
   *  Result lands in the login/signup/invite response as `landingPath`; an
   *  invalid path or a throwing resolver just omits the field. */
  readonly postAuthLanding?: PostAuthLandingResolver;
};

/** Hook for app-specific seeding (demo data, fixtures). Runs after the
 *  admin (when auth is active) in declared order. */
export type SeedFn = (stack: TestStack) => Promise<void>;

/** Dev counterpart of `ProdSeedsConfig`: the declarative shortcuts plus free seeds that get the test stack. */
export type RunDevAppSeedsConfig = Omit<ProdSeedsConfig, "run"> & {
  readonly run?: readonly SeedFn[];
};

export type RunDevAppOptions = {
  /** App-specific features. In auth mode, config/user/tenant/
   *  auth-email-password are mixed in automatically, so they must not be
   *  added manually as well. */
  readonly features: readonly FeatureDefinition[];
  /** Opt-in boot-validator warnings — see ValidateBootOptions. */
  readonly validateBootOptions?: ValidateBootOptions;
  /** One table block for every list of the bundled features, see ComposeFeaturesOptions.bundledLists. */
  readonly bundledLists?: BundledListsOptions;
  /** Browser entry module, bundled to /client.js. Mutually exclusive with
   *  `clientEntries`. */
  readonly clientEntry?: string;
  /** Multi-entry mode: one bundle (`/client-<name>.js`) and one HTML template
   *  per entry; `hostDispatch` picks the entry per request. kumiko-build reads
   *  the same list from package.json `kumiko.clientEntries`. Mutually exclusive
   *  with `clientEntry`. */
  readonly clientEntries?: CreateKumikoServerOptions["clientEntries"];
  /** Multi-entry mode: per-request routing. Required with `clientEntries`,
   *  otherwise the server cannot tell which HTML to serve. */
  readonly hostDispatch?: CreateKumikoServerOptions["hostDispatch"];
  /** Per-request head-metadata resolver — same option, same signature as
   *  `runProdApp`'s `resolvePageHead`, so `bun dev` and every e2e that boots
   *  through `runDevApp` show the same resolved head prod does. See
   *  `CreateKumikoServerOptions.resolvePageHead` for the full contract. */
  readonly resolvePageHead?: PageHeadResolver;
  /** CSS entry. Defaults to the package export
   *  `@cosmicdrift/kumiko-renderer/web/styles.css` when a client entry is set.
   *  `false` disables the CSS pipeline. */
  readonly stylesheet?: string | false;
  /** Tailwind `--watch` process on/off, see `CreateKumikoServerOptions.stylesheetWatch`. */
  readonly stylesheetWatch?: boolean;
  /** Custom HTML template; otherwise uses a minimal default (#root + client.js).
   *  In multi-entry mode, this is the fallback template when an entry does not
   *  define its own htmlPath. */
  readonly htmlPath?: string;
  /** Listening port. Defaults to 4173, or `$PORT` when set. */
  readonly port?: number;
  /** Additional directories for the file watcher to trigger hot reload. */
  readonly watchDirs?: readonly string[];
  /** Installs SIGINT/SIGTERM handlers. Defaults to true; tests can disable
   *  them so repeated boots do not accumulate listeners. */
  readonly installSignalHandlers?: boolean;
  /** Auth mode: standard features mixed in, auth routes wired, seedAdminGuarded
   *  runs in onAfterSetup. Without `auth` the server stays in auto-mint JWT mode. */
  readonly auth?: RunDevAppAuthOptions;
  /** App-defined seed functions, run after the admin seed when auth is active,
   *  in array order. */
  readonly seeds?: readonly SeedFn[] | RunDevAppSeedsConfig;
  /** Additional AppContext keys. `templateResolver` is always added; `secrets`
   *  is added when the secrets feature is mounted; and `configResolver` is
   *  added in auth mode. App values take precedence. Symmetric with runProdApp. */
  /** Boot default locale (BCP-47) for ctx.locale when the request carries
   *  no locale signal. Merged into AppContext before extraContext (app wins). */
  readonly defaultLocale?: string;
  readonly extraContext?: CreateKumikoServerOptions["extraContext"];
  /** App-level config values, same semantics and merge as RunProdAppOptions["appOverrides"]. */
  readonly appOverrides?: ConfigOverridesInput;
  /** MasterKeyProvider for the automatically wired `ctx.secrets`. Defaults to
   *  `createEnvMasterKeyProvider`; override it for KMS backends. Only relevant
   *  when the secrets feature is mounted. Symmetric with runProdApp. */
  readonly masterKey?: MasterKeyProvider;
  /** Subject KMS for PII-annotated fields, the dev counterpart of runProdApp({ kms }).
   *  Unset: an ephemeral DB gets an InMemoryKmsAdapter plus a throwaway blind-index key;
   *  a persistent dev DB (KUMIKO_DEV_DB_NAME) stays plaintext with a boot warning, pass
   *  createPgKmsAdapter against that DB there (in-memory DEKs vanish on restart).
   *  `false`: explicit plaintext, with the boot warning. */
  readonly kms?: KmsAdapter | false;
  /** 32-byte base64 key for blind-index HMACs. Required when `kms` is set and
   *  lookupable fields are mounted; otherwise boot aborts. Symmetric with
   *  runProdApp. */
  readonly blindIndexKey?: string;
  /** Environment source for the ENV-to-config app-override bridge. Keys with
   *  `env:` receive their environment value as the app-override default,
   *  symmetric with runProdApp.
   *  Defaults to `process.env`; injectable as a test seam so tests can provide
   *  custom environment values without mutating the global `process.env`. */
  readonly envSource?: Record<string, string | undefined>;
  /** Anonymous access for public endpoints. Requests without a JWT proceed as
   *  a pseudo-user with the `anonymous` role when the handler includes that
   *  role in `access.roles`. */
  readonly anonymousAccess?: CreateKumikoServerOptions["anonymousAccess"];
  /** File-Storage-Provider — aktiviert die Upload-Routes (/api/files) +
   *  `ctx.files`. Demos: `{ storageProvider: createInMemoryFileProvider() }`. */
  readonly files?: CreateKumikoServerOptions["files"];
  /** App-defined HTTP routes, such as /feed.xml and /sitemap.xml. They are
   *  attached to the Hono app before the static-asset path. Symmetric with the
   *  same-named option in runProdApp. */
  readonly extraRoutes?: CreateKumikoServerOptions["extraRoutes"];
  /** Framework-managed unsubscribe links and routes, same contract as
   *  `RunProdAppOptions.unsubscribe`; the link base URL comes from `auth.mail.baseUrl`
   *  or `APP_BASE_URL` (dev has no `auth.publicOrigin`). */
  readonly unsubscribe?: UnsubscribeOption;
  /** Hook for app-wired co-running components — symmetric to
   *  runProdApp.wire. */
  readonly wire?: CreateKumikoServerOptions["wire"];
  /** Same as `RunProdAppOptions["mail"]`: mounts `channel-email` and wires the auth mail flows. */
  readonly mail?: MailBootOption;
  /** Same as `RunProdAppOptions["fileStorage"]`. */
  readonly fileStorage?: FileStorageBootOption;
  /** Same as `RunProdAppOptions["kmsMode"]`; replaces the dev KMS default and cannot be combined
   *  with `kms` / `blindIndexKey`. */
  readonly kmsMode?: KmsMode;
  /** Same as `RunProdAppOptions["billing"]`. */
  readonly billing?: BillingBootOption;
  /** Same as `RunProdAppOptions["featureToggles"]`: global operator switches over the tier resolver. */
  readonly featureToggles?: boolean;
  /** Same as `RunProdAppOptions["demoMode"]`. */
  readonly demoMode?: DemoModeOption;
  /** Composed env schema (see `RunProdAppOptions["envSchema"]`). When set, the env is validated
   *  against it plus the blocks the boot options above need, and a violation throws a
   *  `KumikoBootError`. Dev does not run the dry-run modes. */
  readonly envSchema?: ComposedEnvSchema;
  /** Print a first-run banner after the server starts (URL, admin login,
   *  hot-reload hint, docs link). Default: off — apps that already log
   *  their own startup shouldn't get double-printed. The scaffold template
   *  (create-kumiko-app) flips this on so the first `bun dev` ends on
   *  something the user can click. Pass an object to override the
   *  features-dir hint or the docs URL. */
  readonly welcomeBanner?: boolean | { readonly featuresDir?: string; readonly docsUrl?: string };
  /** Forwarded to createKumikoServer → setupTestStack's top-level
   *  `trustedProxyHops` — symmetric to
   *  RunProdAppOptions.trustedProxyHops. Wins over the deprecated
   *  `auth.trustedProxyHops`, which wins over the `KUMIKO_TRUSTED_PROXY_HOPS`
   *  env var. Dev usually runs unproxied, so this is normally left unset
   *  (default 0). */
  readonly trustedProxyHops?: number;
  /** Links the app's own error reasons to its own docs (`docsUrl` in error responses); framework reasons keep the framework docs link. */
  readonly errorDocs?: ErrorDocsConfig;
  /** Row level security of the dev stack, as in prod. Default "on", so tenant-isolation bugs show up in development. */
  readonly rowLevelSecurity?: RowLevelSecurityMode;
};

export async function runDevApp(options: RunDevAppOptions): Promise<KumikoServerHandle> {
  const bootFailure: BootFailureCleanup = { release: undefined };
  try {
    return await bootDevApp(options, bootFailure);
  } catch (error) {
    // Anything that throws after the KMS wiring is open (boot gates, server creation) must close it.
    await bootFailure.release?.().catch(() => {});
    throw error;
  }
}

async function bootDevApp(
  options: RunDevAppOptions,
  bootFailure: BootFailureCleanup,
): Promise<KumikoServerHandle> {
  const config = await resolveDevBootConfig(options, bootFailure);
  const bootCrypto = validateDevBoot(options, config);
  const lateBindings = createDevLateBindings();
  const tierResolverUsage = findTierResolverUsage(config.features);
  const effectiveFeatures = createLateBoundEffectiveFeatures(
    lateBindings,
    Boolean(tierResolverUsage || config.wiring.featureToggles),
  );
  const { releasePiiKms } = configureDevBootCrypto(
    options,
    config,
    bootCrypto,
    lateBindings.resets,
    bootFailure,
  );
  const { registry, sessionStoreProviderMounted } = resolveDevAuthRegistry(config);
  const extraContext = buildDevExtraContext(options, config, registry, bootCrypto);
  const auth = wireDevAuth(config, registry, sessionStoreProviderMounted, lateBindings);

  const trustedProxyHops =
    options.trustedProxyHops ??
    config.effectiveAuth?.trustedProxyHops ??
    parseTrustedProxyHopsEnv(config.envSource[TRUSTED_PROXY_HOPS_ENV], "runDevApp");

  const handle = await createKumikoServer({
    ...buildDevServerOptions({
      options,
      config,
      auth,
      extraContext,
      trustedProxyHops,
      effectiveFeatures,
    }),
    onAfterSetup: (stack) => runDevAfterSetup(stack, { config, bootCrypto, auth, lateBindings }),
  });
  bootFailure.release = undefined;

  if (options.welcomeBanner) {
    const banner = renderDevWelcomeBanner(options, config, handle);
    // biome-ignore lint/suspicious/noConsole: boot-time UX print, opt-in via welcomeBanner.
    console.log(`\n${banner}\n`);
  }

  return {
    ...handle,
    stop: async () => {
      try {
        await handle.stop();
      } finally {
        await releasePiiKms();
      }
    },
  };
}

function renderDevWelcomeBanner(
  options: RunDevAppOptions,
  config: DevBootConfig,
  handle: KumikoServerHandle,
): string {
  const { effectiveAuth } = config;
  const overrides = typeof options.welcomeBanner === "object" ? options.welcomeBanner : {};
  const port = handle.server?.port ?? options.port ?? 3000;
  return renderWelcomeBanner({
    url: `http://localhost:${port}`,
    ...(effectiveAuth?.admin && {
      admin: {
        email: effectiveAuth.admin.email,
        password: effectiveAuth.admin.password,
      },
    }),
    ...(overrides.featuresDir !== undefined && { featuresDir: overrides.featuresDir }),
    ...(overrides.docsUrl !== undefined && { docsUrl: overrides.docsUrl }),
  });
}

// Provide the configResolver default for the config feature in auth mode;
// in no-auth mode, leave that choice to the caller. Wrap the factory so the
// spread applies to its result; spreading the function itself is a no-op. The
// ENV-to-config bridge supplies app-override defaults from `env:` keys.
// The temporary registry extracts only config keys because the resolver is
// built before server boot, and stack.registry only exists from onAfterSetup;
// createKumikoServer builds its own registry internally.
// Automatically wire templateResolver and feature-gated secrets, symmetrically
// with runProdApp. Unlike prod, the database is available here only in the
// factory dependencies because createKumikoServer builds the stack. Therefore
// use a factory: buildBootExtraContext runs with hasAuth:false because
// configResolver already comes from cfgExtra, and cfgExtra values override
// the boot defaults.
function buildDevExtraContext(
  options: RunDevAppOptions,
  config: DevBootConfig,
  registry: Registry | undefined,
  bootCrypto: ReturnType<typeof resolveBootCrypto>,
): CreateKumikoServerOptions["extraContext"] {
  const { features, envSource, unsubscribeLinks } = config;
  const cfgExtra = registry
    ? mergeConfigResolverDefault(
        options.extraContext,
        registry,
        envSource,
        bootCrypto.configCipher,
        options.appOverrides,
      )
    : options.extraContext;
  return (deps) => {
    const base = typeof cfgExtra === "function" ? cfgExtra(deps) : (cfgExtra ?? {});
    const bootLogger = loggerFromExtraContext(base);
    const boot = buildBootExtraContext({
      db: deps.db,
      features,
      envSource,
      registry: deps.registry,
      hasAuth: false,
      sseBroker: deps.sseBroker,
      redis: deps.redis,
      crypto: bootCrypto,
      ...(bootLogger && { log: bootLogger }),
      ...(unsubscribeLinks && { unsubscribeLinks }),
    });
    return {
      ...boot,
      ...(options.defaultLocale !== undefined && { defaultLocale: options.defaultLocale }),
      ...base,
    };
  };
}

// Exported for the wiring-contract test (config-resolver-default.integration):
// pins that the dev configResolver-default carries the ENV→app-override bridge
// and that a caller-supplied configResolver still overrides it. Not re-exported
// from the package barrel (index.ts lists only runDevApp).
export function mergeConfigResolverDefault(
  ctx: CreateKumikoServerOptions["extraContext"],
  registry: Registry,
  envSource: Record<string, string | undefined>,
  cipher?: EnvelopeCipher,
  appOverrides?: ConfigOverridesInput,
): CreateKumikoServerOptions["extraContext"] {
  const defaults = {
    configResolver: createConfigResolver({
      appOverrides: buildConfigOverrides(registry, envSource, appOverrides),
      ...(cipher && { cipher }),
    }),
  };
  // Build ctx.config per request through configAccessorFactory (see
  // addConfigAccessorFactory); otherwise
  // ctx.config remains undefined and handlers such as createFileProviderForTenant
  // throw. Build it from the effective resolver so a caller override wins,
  // symmetrically with runProdApp.
  if (ctx === undefined) return addConfigAccessorFactory(defaults, registry);
  if (typeof ctx === "function") {
    return (deps) => addConfigAccessorFactory({ ...defaults, ...ctx(deps) }, registry);
  }
  return addConfigAccessorFactory({ ...defaults, ...ctx }, registry);
}
