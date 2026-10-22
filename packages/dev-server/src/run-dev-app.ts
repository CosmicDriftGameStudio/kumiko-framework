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

import {
  AuthErrors,
  AuthHandlers,
  AuthQueries,
} from "@cosmicdrift/kumiko-bundled-features/auth-email-password";
import {
  type SeedAdminOptions,
  seedAdminGuarded,
} from "@cosmicdrift/kumiko-bundled-features/auth-email-password/seeding";
import {
  EXT_SESSION_STORE,
  resolveSessionStore,
  resolveTokenVerifier,
  type SessionStore,
} from "@cosmicdrift/kumiko-bundled-features/auth-foundation";
import {
  AUTH_MFA_FEATURE,
  AuthMfaHandlers,
  bindMfaRevokeAllOtherSessionsFromFeature,
  bindMfaTokenSecretsFromFeature,
  bindRevokeAllPatTokensFromFeature,
} from "@cosmicdrift/kumiko-bundled-features/auth-mfa";
import {
  buildEnvConfigOverrides,
  createConfigResolver,
} from "@cosmicdrift/kumiko-bundled-features/config";
import {
  bindPatAutoRevokeOnPasswordChangeFromFeature,
  PAT_FEATURE,
  patRateLimitFromFeature,
  revokeAllPatTokensForUser,
} from "@cosmicdrift/kumiko-bundled-features/personal-access-tokens";
import {
  bindAutoRevokeFromFeature,
  SESSIONS_FEATURE,
} from "@cosmicdrift/kumiko-bundled-features/sessions";
import { TenantQueries } from "@cosmicdrift/kumiko-bundled-features/tenant";
import type {
  PostAuthLandingResolver,
  SessionMetadata,
  TokenVerifier,
} from "@cosmicdrift/kumiko-framework/api";
import {
  createInMemoryLoginRateLimiter,
  parseTrustedProxyHopsEnv,
  TRUSTED_PROXY_HOPS_ENV,
} from "@cosmicdrift/kumiko-framework/api";
import {
  configureBlindIndexKey,
  configurePiiSubjectKms,
  type KmsAdapter,
} from "@cosmicdrift/kumiko-framework/crypto";
import { configureEntityFieldEncryption } from "@cosmicdrift/kumiko-framework/db";
import {
  collectWriteHandlerQns,
  createRegistry,
  type EffectiveFeaturesResolver,
  type FeatureDefinition,
  FILE_STORAGE_PROVIDER_BOOT_SENTINEL,
  FILE_STORAGE_PROVIDER_ENV,
  findTierResolverUsage,
  type Registry,
  requireTierResolverPlugin,
  type SessionUser,
  type TenantId,
  type ValidateBootOptions,
  validateAppCustomScreenWriteQns,
  validateBoot,
} from "@cosmicdrift/kumiko-framework/engine";
import { type ComposedEnvSchema, parseEnv } from "@cosmicdrift/kumiko-framework/env";
import type { ErrorDocsConfig } from "@cosmicdrift/kumiko-framework/errors";
import { createFallbackLogger } from "@cosmicdrift/kumiko-framework/logging";
import type { EnvelopeCipher, MasterKeyProvider } from "@cosmicdrift/kumiko-framework/secrets";
import { warnIfNonUtcServerTimeZone } from "@cosmicdrift/kumiko-framework/time";
import type { PageHeadResolver } from "@cosmicdrift/kumiko-renderer/headless/apex";
import {
  assertStackBootRequirements,
  type BillingBootOption,
  type DemoModeOption,
  type FileStorageBootOption,
  isSeedFnList,
  type KmsMode,
  type MailBootOption,
  type ProdSeedsConfig,
  rejectRemovedEffectiveFeatures,
  resolveBootOptionWiring,
  withBootOptionEnvBlocks,
} from "@cosmicdrift/kumiko-server-runtime";
import { applyBootSeeds } from "@cosmicdrift/kumiko-server-runtime/boot/apply-boot-seeds";
import { resolveBootCrypto } from "@cosmicdrift/kumiko-server-runtime/boot/boot-crypto";
import {
  buildComposeAuthOptions,
  composeFeatures,
} from "@cosmicdrift/kumiko-server-runtime/compose-features";
import { assertPiiBootInvariants } from "@cosmicdrift/kumiko-server-runtime/pii-boot-gate";
import { assertSessionBootInvariants } from "@cosmicdrift/kumiko-server-runtime/session-boot-gate";
import type { TestStack } from "@cosmicdrift/kumiko-testing/stack";
import {
  type CreateKumikoServerOptions,
  createKumikoServer,
  type KumikoServerHandle,
  logInfo,
} from "./create-kumiko-server.ts";
import {
  captureEphemeralDevPiiKms,
  type DevPiiKmsResolution,
  resolveDevPiiKms,
} from "./resolve-dev-pii-kms.ts";
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
  loggerFromExtraContext,
  requireEnv,
  resolveAuthMail,
  resolveUnsubscribeWiring,
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
};

export async function runDevApp(options: RunDevAppOptions): Promise<KumikoServerHandle> {
  // Automatically mixes standard features in auth mode through composeFeatures.
  // runProdApp and the per-app Drizzle schema generator use the same helper,
  // keeping migrations and runtime feature composition aligned.
  const rawEnvSource = options.envSource ?? process.env;
  const seedsConfig =
    options.seeds !== undefined && !isSeedFnList(options.seeds) ? options.seeds : undefined;
  const stackSeeds =
    options.seeds === undefined
      ? []
      : isSeedFnList(options.seeds)
        ? options.seeds
        : (options.seeds.run ?? []);
  if (options.envSchema) {
    // Free dev seeds take the test stack; the env blocks only read the declarative part.
    const { seeds: _devSeeds, kms: devKms, ...bootFields } = options;
    const composed = withBootOptionEnvBlocks(options.envSchema, {
      ...bootFields,
      ...(devKms && { kms: devKms }),
      ...(seedsConfig && { seeds: { ...seedsConfig, run: [] } }),
      features: options.features,
    });
    parseEnv(composed.schema, rawEnvSource, { sources: composed.sources });
  }
  rejectRemovedEffectiveFeatures(options);
  const wiring = await resolveBootOptionWiring(
    {
      features: options.features,
      ...(options.mail && { mail: options.mail }),
      ...(options.fileStorage && { fileStorage: options.fileStorage }),
      ...(options.kmsMode !== undefined && { kmsMode: options.kmsMode }),
      ...(options.billing && { billing: options.billing }),
      ...(options.featureToggles && { featureToggles: true }),
      ...(options.demoMode && { demoMode: options.demoMode }),
      ...(seedsConfig && { seeds: { ...seedsConfig, run: [] } }),
      ...(options.kms && { kms: options.kms }),
      ...(options.blindIndexKey !== undefined && { blindIndexKey: options.blindIndexKey }),
      ...(options.auth && { auth: options.auth }),
    },
    rawEnvSource,
  );
  const envSource: Record<string, string | undefined> =
    Object.keys(wiring.envDefaults).length > 0
      ? { ...wiring.envDefaults, ...rawEnvSource }
      : rawEnvSource;
  assertStackBootRequirements(
    {
      features: options.features,
      ...(options.featureToggles && { featureToggles: true }),
    },
    ["featureToggles"],
  );
  // Normalizes auth.mail into the explicit flow fields, symmetrically with
  // runProdApp. hmacSecret is read from the JWT_SECRET environment value and
  // fails fast when unavailable. From this point on, use effectiveAuth rather
  // than options.auth.
  const effectiveAuth = options.auth
    ? resolveAuthMail(options.auth, requireEnv("JWT_SECRET", envSource, "runDevApp"), envSource, {
        mailConfigured: wiring.mailConfigured,
      })
    : undefined;
  const composeAuthOptions = buildComposeAuthOptions(effectiveAuth);
  const { unsubscribeLinks, unsubscribeRoutes } = resolveUnsubscribeWiring({
    unsubscribe: options.unsubscribe,
    publicOrigin: undefined,
    mailBaseUrl: effectiveAuth?.mail?.baseUrl,
    envSource,
    warn: (message) => createFallbackLogger("runDevApp").warn(message),
  });
  const extraRoutes =
    unsubscribeRoutes.length === 0 && wiring.extraRoutes.length === 0
      ? options.extraRoutes
      : [...(options.extraRoutes ?? []), ...unsubscribeRoutes, ...wiring.extraRoutes];
  const features = composeFeatures([...options.features, ...wiring.features], {
    includeBundled: !!effectiveAuth,
    ...(composeAuthOptions && { authOptions: composeAuthOptions }),
  });

  // An explicitly wired file provider (options.files) satisfies the
  // FILE_STORAGE_PROVIDER boot gate. Passed via the validateBoot env option
  // instead of mutating process.env, so nothing leaks into later runDevApp
  // calls in the same process.
  const baseBootEnv = {
    ...wiring.envDefaults,
    ...(options.validateBootOptions?.env ?? process.env),
  };
  const hasBootEnvDefaults = Object.keys(wiring.envDefaults).length > 0;
  const bootOptions: ValidateBootOptions | undefined =
    options.files !== undefined && baseBootEnv[FILE_STORAGE_PROVIDER_ENV] === undefined
      ? {
          ...options.validateBootOptions,
          env: { ...baseBootEnv, [FILE_STORAGE_PROVIDER_ENV]: FILE_STORAGE_PROVIDER_BOOT_SENTINEL },
        }
      : hasBootEnvDefaults
        ? { ...options.validateBootOptions, env: baseBootEnv }
        : options.validateBootOptions;

  // Run boot validation before creating the server. This catches the same
  // errors runProdApp catches (unqualified navigation or handler QNs,
  // screen-access violations), which would otherwise only show up as a prod pod
  // in CrashLoopBackOff. It throws
  // synchronously before a socket is opened.
  // Resolve this before validateBoot: an app-supplied masterKey provider must
  // satisfy the encrypted-field gate exactly as it does in runProdApp.
  const bootCrypto = resolveBootCrypto(envSource, options.masterKey);
  validateBoot(features, {
    ...(bootCrypto.entityFieldCipher && { entityFieldCipher: bootCrypto.entityFieldCipher }),
    ...bootOptions,
  });
  warnIfNonUtcServerTimeZone();
  validateAppCustomScreenWriteQns(process.cwd(), collectWriteHandlerQns(features));

  // Tier-Composition auto-wire: scan features for a
  // tenantTierResolver-extension and wire a late-bound wrapper here; it is
  // filled in onAfterSetup (where stack.db + stack.registry are available).
  // The global operator toggles layer over the same wrapper.
  // App-Author sees nothing — `createTierEngineFeature(opts)` mounts +
  // framework auto-wires.
  const tierResolverUsage = findTierResolverUsage(features);
  const tierResolverHolder: { resolver: EffectiveFeaturesResolver | undefined } = {
    resolver: undefined,
  };
  const finalEffectiveFeatures: EffectiveFeaturesResolver | undefined =
    tierResolverUsage || wiring.featureToggles
      ? Object.assign(
          (tenantId: TenantId) => {
            // Defensive: Server starts AFTER onAfterSetup completes, so the
            // resolver is filled before any request comes in. Throwing here
            // means a programming error (boot order) rather than silent
            // "all-features-on" misbehavior.
            if (!tierResolverHolder.resolver) {
              throw new Error(
                "tier-resolver: extension found but resolver not yet built — boot order issue?",
              );
            }
            return tierResolverHolder.resolver(tenantId);
          },
          {
            // The real trialGate lands on holder.resolver only after plugin.build(). Delegate rather than
            // copy it because this wrapper closure is created before build().
            // Return false when no trial gate is available.
            trialGate: (tenantId: TenantId, featureName: string): Promise<boolean> =>
              tierResolverHolder.resolver?.trialGate?.(tenantId, featureName) ??
              Promise.resolve(false),
          },
        )
      : undefined;

  // Provide the configResolver default for the config feature in auth mode;
  // in no-auth mode, leave that choice to the caller. Wrap the factory so the
  // spread applies to its result; spreading the function itself is a no-op. The
  // ENV-to-config bridge supplies app-override defaults from `env:` keys.
  // The temporary registry extracts only config keys because the resolver is
  // built before server boot, and stack.registry only exists from onAfterSetup;
  // createKumikoServer builds its own registry internally.
  // The app-wide cipher for `encrypted: true` entity fields is resolved lazily
  // by executors, symmetrically with runProdApp.
  configureEntityFieldEncryption(bootCrypto.entityFieldCipher);
  // Configure Subject-KMS and blind-index handling, symmetrically with
  // runProdApp. Dev warns instead of failing for plaintext PII, but kms with
  // lookupable fields still requires blindIndexKey because lookups would fail
  // in every mode.
  const piiKms: DevPiiKmsResolution =
    options.kmsMode !== undefined
      ? {
          kms: wiring.kms.kms,
          blindIndexKey: wiring.kms.blindIndexKey,
          generatedBlindIndexKey: false,
          mode: wiring.kms.kms ? "app-kms" : "plaintext",
        }
      : resolveDevPiiKms(options);
  configurePiiSubjectKms(piiKms.kms);
  configureBlindIndexKey(piiKms.blindIndexKey);
  const releaseEphemeralPiiKms = captureEphemeralDevPiiKms(piiKms);
  // The auth features bind database-backed revokers onto their (possibly shared) instances;
  // stop() swaps them for inert ones so a later stack in the same process never reaches this
  // app's closed connection.
  const resetLateBindings: Array<() => void> = [];
  const releasePiiKms = async (): Promise<void> => {
    for (const reset of resetLateBindings) reset();
    releaseEphemeralPiiKms();
    await wiring.kms.close();
  };
  assertPiiBootInvariants(features, {
    kms: piiKms.kms,
    blindIndexKey: piiKms.blindIndexKey,
    mode: "dev",
  });
  if (piiKms.mode === "ephemeral-default") {
    logInfo(
      "[runDevApp] PII encrypted with in-memory KMS (ephemeral DB); pass kms: false to opt out",
    );
  }
  // Throwaway registry, built once and reused below — mirrors runProdApp's
  // `createRegistry(features)` right after validateBoot. Symmetric
  // sessionStoreProviderMounted check to runProdApp's (registry.getExtension-
  // Usages, not a raw features.some(...) scan) so dev and prod never ask the
  // same question two different ways again.
  const registry = effectiveAuth ? createRegistry(features) : undefined;
  const sessionStoreProviderMounted =
    registry !== undefined && registry.getExtensionUsages(EXT_SESSION_STORE).length > 0;
  assertSessionBootInvariants({
    hasAuth: Boolean(effectiveAuth),
    sessionStoreProviderMounted,
    mode: "dev",
  });
  const cfgExtra = registry
    ? mergeConfigResolverDefault(options.extraContext, registry, envSource, bootCrypto.configCipher)
    : options.extraContext;
  // Automatically wire templateResolver and feature-gated secrets, symmetrically
  // with runProdApp. Unlike prod, the database is available here only in the
  // factory dependencies because createKumikoServer builds the stack. Therefore
  // use a factory: buildBootExtraContext runs with hasAuth:false because
  // configResolver already comes from cfgExtra, and cfgExtra values override
  // the boot defaults.
  const extraContext: CreateKumikoServerOptions["extraContext"] = (deps) => {
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

  // Sessions: late-bound holder — resolveSessionStore needs concrete db+
  // registry (only after setupTestStack). Wired when sessions feature is
  // mounted; no auth.sessions opt-in anymore.
  let sessionStore: SessionStore | undefined;
  const requireSessionStore = (): SessionStore => {
    if (!sessionStore) {
      throw new Error("[runDevApp] sessionStore accessed before onAfterSetup");
    }
    return sessionStore;
  };
  // Token-verifier opt-in: same late-bound holder pattern — resolveTokenVerifier
  // needs the real db+registry (only concrete after setupTestStack). Wired
  // whenever a provider feature (personal-access-tokens today) is mounted.
  let tokenVerifier: TokenVerifier | undefined;
  const patFeature = features.find((f) => f.name === PAT_FEATURE);
  const mfaFeature = features.find((f) => f.name === AUTH_MFA_FEATURE);
  // Same master secret as runProdApp. Without JWT_SECRET the feature keeps
  // its explicit secrets, or its handlers report the missing binding.
  const devMasterSecret = envSource["JWT_SECRET"];
  if (mfaFeature && devMasterSecret) {
    bindMfaTokenSecretsFromFeature(mfaFeature)?.(devMasterSecret, envSource);
  }
  if (
    effectiveAuth &&
    mfaFeature &&
    registry?.getWriteHandler(AuthHandlers.switchTenantMfaGate) === undefined
  ) {
    throw new Error(
      `[runDevApp] auth-mfa is mounted but ${AuthHandlers.switchTenantMfaGate} is not registered: ` +
        "createAuthEmailPasswordFeature registers it only when mfaStatusChecker is set, and without it " +
        "POST /auth/switch-tenant would mint sessions without the second factor",
    );
  }
  const patAuthFragment = patFeature
    ? {
        tokenVerifier: (rawToken: string) => {
          if (!tokenVerifier) {
            throw new Error("[runDevApp] token-verifier accessed before onAfterSetup");
          }
          return tokenVerifier(rawToken);
        },
        patRateLimiter: (() => {
          const rl = patRateLimitFromFeature(patFeature);
          return createInMemoryLoginRateLimiter(rl.maxRequests, rl.windowMs);
        })(),
      }
    : {};

  // Parity with runProdApp: gate on sessionStore provider, not
  // the sessions feature name — a custom provider must also wire auth
  // callbacks. sessionStoreProviderMounted computed above via the registry
  // (same check as runProdApp) — not recomputed here.
  const sessionAuthFragment =
    effectiveAuth && sessionStoreProviderMounted
      ? {
          sessionCreator: (user: SessionUser, meta: SessionMetadata) =>
            requireSessionStore().creator(user, meta),
          sessionRevoker: (sid: string) => requireSessionStore().revoker(sid),
          sessionChecker: (sid: string, userId: string) =>
            requireSessionStore().checker(sid, userId),
        }
      : {};

  const trustedProxyHops =
    options.trustedProxyHops ??
    effectiveAuth?.trustedProxyHops ??
    parseTrustedProxyHopsEnv(envSource[TRUSTED_PROXY_HOPS_ENV], "runDevApp");

  const handle = await createKumikoServer({
    features,
    ...(options.clientEntry !== undefined && { clientEntry: options.clientEntry }),
    ...(options.errorDocs && { errorDocs: options.errorDocs }),
    ...(options.clientEntries !== undefined && { clientEntries: options.clientEntries }),
    ...(options.hostDispatch !== undefined && { hostDispatch: options.hostDispatch }),
    ...(options.resolvePageHead !== undefined && { resolvePageHead: options.resolvePageHead }),
    ...(options.stylesheet !== undefined && { stylesheet: options.stylesheet }),
    ...(options.stylesheetWatch !== undefined && { stylesheetWatch: options.stylesheetWatch }),
    ...(options.htmlPath !== undefined && { htmlPath: options.htmlPath }),
    ...(options.port !== undefined && { port: options.port }),
    ...(options.watchDirs !== undefined && { watchDirs: options.watchDirs }),
    ...(options.installSignalHandlers !== undefined && {
      installSignalHandlers: options.installSignalHandlers,
    }),
    ...(extraContext !== undefined && { extraContext }),
    ...(options.anonymousAccess !== undefined && { anonymousAccess: options.anonymousAccess }),
    ...(options.files !== undefined && { files: options.files }),
    ...(extraRoutes !== undefined && { extraRoutes }),
    ...(options.wire !== undefined && { wire: options.wire }),
    ...(trustedProxyHops !== undefined && { trustedProxyHops }),
    ...(options.demoMode && { wrapFetch: wiring.wrapFetch }),
    ...(finalEffectiveFeatures !== undefined && {
      effectiveFeatures: finalEffectiveFeatures,
    }),
    ...(effectiveAuth && {
      auth: {
        membershipQuery: TenantQueries.memberships,
        loginHandler: AuthHandlers.login,
        loginErrorStatusMap: effectiveAuth.loginErrorStatusMap ?? {
          [AuthErrors.invalidCredentials]: 401,
          [AuthErrors.noMembership]: 403,
        },
        ...(effectiveAuth.cookieDomain !== undefined && {
          cookieDomain: effectiveAuth.cookieDomain,
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
        ...(effectiveAuth.trustedProxyHops !== undefined && {
          trustedProxyHops: effectiveAuth.trustedProxyHops,
        }),
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
    onAfterSetup: async (stack) => {
      // Build tier-resolver BEFORE any seeds so seeds can rely
      // on the resolver being live (e.g. seed that writes a SystemAdmin's
      // tier-assignment can immediately read tier-cuts).
      if (tierResolverUsage) {
        tierResolverHolder.resolver = await requireTierResolverPlugin(tierResolverUsage).build({
          db: stack.db,
          registry: stack.registry,
          cacheSync: stack.cacheSync,
        });
      }
      if (wiring.featureToggles) {
        const bound = await wiring.featureToggles.bind({
          db: stack.db,
          registry: stack.registry,
          cacheSync: stack.cacheSync,
          tierResolver: tierResolverHolder.resolver,
        });
        tierResolverHolder.resolver = bound.resolver;
      }
      if (effectiveAuth && stack.registry.getExtensionUsages(EXT_SESSION_STORE).length > 0) {
        // Secure-by-default: resolve sessionStore provider; bind
        // password-change mass-revoke + MFA revokeAllOthers.
        const store = await resolveSessionStore({
          db: stack.db,
          registry: stack.registry,
        });
        const sessionsFeature = features.find((f) => f.name === SESSIONS_FEATURE);
        if (sessionsFeature) {
          bindReleasable(
            bindAutoRevokeFromFeature(sessionsFeature),
            store.massRevoker,
            INERT_REVOKER,
            resetLateBindings,
          );
        }
        if (mfaFeature) {
          bindReleasable(
            bindMfaRevokeAllOtherSessionsFromFeature(mfaFeature),
            store.revokeAllOthers,
            INERT_REVOKER,
            resetLateBindings,
          );
        }
        if (mfaFeature && patFeature) {
          bindReleasable(
            bindRevokeAllPatTokensFromFeature(mfaFeature),
            (userId) => revokeAllPatTokensForUser(stack.db, userId),
            INERT_REVOKER,
            resetLateBindings,
          );
        }
        sessionStore = store;
      }
      if (patFeature) {
        tokenVerifier = (rawToken) =>
          resolveTokenVerifier({ db: stack.db, registry: stack.registry }, rawToken);
        // Password-change → PAT-revoke: independent of sessions/MFA being
        // mounted, so wired unconditionally here whenever PAT itself is.
        bindReleasable(
          bindPatAutoRevokeOnPasswordChangeFromFeature(patFeature),
          (userId) => revokeAllPatTokensForUser(stack.db, userId),
          INERT_REVOKER,
          resetLateBindings,
        );
      }
      if (effectiveAuth) {
        await seedAdminGuarded(stack.db, effectiveAuth.admin);
      }
      // Apply r.config({ seeds }) declared by any registered feature.
      // Runs before user-supplied seed callbacks so those can read /
      // override the deploy-defaults. The helper indirection is what
      // config-seed-boot.integration.ts pins — keep it as a single call.
      for (const seed of wiring.shortcutSeeds) {
        await seed(stack.db);
      }
      await applyBootSeeds({
        registry: stack.registry,
        db: stack.db,
        ...(bootCrypto.configCipher && { cipher: bootCrypto.configCipher }),
      });
      for (const seed of stackSeeds) {
        await seed(stack);
      }
    },
  }).catch(async (error: unknown) => {
    await releasePiiKms().catch(() => {});
    throw error;
  });

  if (options.welcomeBanner) {
    const overrides = typeof options.welcomeBanner === "object" ? options.welcomeBanner : {};
    const port = handle.server?.port ?? options.port ?? 3000;
    const banner = renderWelcomeBanner({
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

const INERT_REVOKER = async (): Promise<number> => 0;

// Binds a late-bound revoker and records how to swap it for an inert one when the app stops.
function bindReleasable<Revoker>(
  bind: ((revoker: Revoker) => void) | undefined,
  revoker: Revoker,
  inert: NoInfer<Revoker>,
  resets: Array<() => void>,
): void {
  if (bind) {
    bind(revoker);
    resets.push(() => bind(inert));
  }
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
): CreateKumikoServerOptions["extraContext"] {
  const defaults = {
    configResolver: createConfigResolver({
      appOverrides: buildEnvConfigOverrides(registry, envSource),
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
