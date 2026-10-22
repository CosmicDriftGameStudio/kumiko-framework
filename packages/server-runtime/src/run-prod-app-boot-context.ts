import {
  AUDIT_FEATURE,
  createEscapeHatchAuditSink,
} from "@cosmicdrift/kumiko-bundled-features/audit";
import {
  type AccountUnlockOptions,
  type AuthPath,
  type EmailVerificationOptions,
  makeAuthPaths,
  type PasswordResetOptions,
} from "@cosmicdrift/kumiko-bundled-features/auth-email-password";
import { resolveSessionStore } from "@cosmicdrift/kumiko-bundled-features/auth-foundation";
import {
  bindMfaRevokeAllOtherSessionsFromFeature,
  bindRevokeAllPatTokensFromFeature,
} from "@cosmicdrift/kumiko-bundled-features/auth-mfa";
import { createSmtpTransportFromEnv } from "@cosmicdrift/kumiko-bundled-features/channel-email";
import {
  buildEnvConfigOverrides,
  createConfigAccessorFactory,
  createConfigResolver,
  validateAppOverrides,
} from "@cosmicdrift/kumiko-bundled-features/config";
import {
  collectChannels,
  createDeliveryNotifyFactory,
  createDeliveryService,
  DELIVERY_FEATURE,
  type UnsubscribeLinkConfig,
} from "@cosmicdrift/kumiko-bundled-features/delivery";
import {
  bindPatAutoRevokeOnPasswordChangeFromFeature,
  revokeAllPatTokensForUser,
} from "@cosmicdrift/kumiko-bundled-features/personal-access-tokens";
import {
  createSecretsContext,
  SECRETS_FEATURE_NAME,
  type SecretsContext,
} from "@cosmicdrift/kumiko-bundled-features/secrets";
import { bindAutoRevokeFromFeature } from "@cosmicdrift/kumiko-bundled-features/sessions";
import { createTemplateResolverApi } from "@cosmicdrift/kumiko-bundled-features/template-resolver";
import { TENANT_FEATURE, TenantQueries } from "@cosmicdrift/kumiko-bundled-features/tenant";
import type { SseBroker } from "@cosmicdrift/kumiko-framework/api";
import type { KmsAdapter } from "@cosmicdrift/kumiko-framework/crypto";
import { createTenantDb, type DbConnection } from "@cosmicdrift/kumiko-framework/db";
import {
  type ConfigResolver,
  createSystemUser,
  type EscapeHatchAuditSink,
  type FeatureDefinition,
  type NotifyFactory,
  type Registry,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import { createFallbackLogger, type Logger } from "@cosmicdrift/kumiko-framework/logging";
import type { EnvelopeCipher, MasterKeyProvider } from "@cosmicdrift/kumiko-framework/secrets";
import type { Redis } from "ioredis";
import { type BootCrypto, resolveBootCrypto } from "./boot/boot-crypto.ts";
import type {
  AccountUnlockSetup,
  AuthMailOptions,
  EmailVerificationSetup,
  InviteSetup,
  PasswordResetSetup,
  SignupSetup,
} from "./run-prod-app.ts";

// Boot-time context helpers for runProdApp: ctx-extra-context wiring
// (templateResolver/delivery/secrets/config-resolver), auth-mail convenience
// normalization, and prod session-auth wiring. Split out of run-prod-app.ts
// — mechanical relocation, these are self-contained pure
// functions, no closure over runProdApp's local boot state.

// Shared with runDevApp (mergeConfigResolverDefault) for dev/prod parity.
export function addConfigAccessorFactory<T extends { readonly configResolver?: ConfigResolver }>(
  resolved: T,
  registry: Registry,
): T {
  if (!resolved.configResolver) return resolved;
  // Both keys, always overriding an app-supplied value: the factory must derive from the
  // effective resolver; the underscore alias stays until the next major.
  const configAccessorFactory = createConfigAccessorFactory(registry, resolved.configResolver);
  return {
    ...resolved,
    configAccessorFactory,
    _configAccessorFactory: configAccessorFactory,
  };
}

// Framework-default providers for AppContext, using the same mechanism as
// tenantTierResolver auto-wiring (findTierResolverUsage): a mounted feature declares
// the need, the default comes from db/env, and the app can override the exception.
// templateResolver is always wired (createTemplateResolverApi never throws; it only
// creates a db-bound accessor). secrets is auto-wired only when the secrets feature is
// mounted AND a KEK is available (masterKey override OR env KEK present); otherwise it
// is skipped so eager KEK detection and provider/cipher construction remain in
// boot/boot-crypto.ts (envHasMasterKek, resolveBootCrypto), shared with runDevApp.
// A production misconfiguration (secrets mounted without a KEK) is caught by
// secretsEnvSchema during boot; without the env-schema path, requireSecretsContext
// throws with a wiring hint on the first ctx.secrets access. configResolver is only
// wired in auth mode. Exported and pure for unit tests; the caller merges it with
// app values (the app wins).

// Prod/dev parity for ctx.notify: without this `_notifyFactory` is only wired
// in tests (createDeliveryTestContext), so ctx.notify is undefined at runtime
// and every notification silently skips. sseBroker optional (email/push don't
// need it, in-app SSE does). Queued channels go through the delivery jobs of
// the calling context's job runner (3rd factory arg); without one they send
// inline, with `secrets` for chat-channel credentials. `to: { tenant }` resolves
// through tenantUserIdsQuery, which the caller sets when the tenant feature is mounted.
function buildDeliveryNotifyFactory(opts: {
  readonly db: DbConnection;
  readonly registry: Registry;
  readonly secrets?: SecretsContext;
  readonly addressCipher?: EnvelopeCipher;
  readonly sseBroker?: SseBroker;
  readonly escapeHatchAuditSink?: EscapeHatchAuditSink;
  readonly log?: Logger;
  readonly redis?: Redis;
  readonly tenantUserIdsQuery?: string;
  readonly configResolver: ConfigResolver | undefined;
  readonly deliverQueuedInline: boolean | undefined;
  readonly unsubscribeLinks: UnsubscribeLinkConfig | undefined;
}): NotifyFactory {
  if (!opts.addressCipher && opts.deliverQueuedInline !== true) {
    createFallbackLogger("delivery", opts.log).warn(
      "No master key configured: queued delivery jobs carry recipient addresses in plaintext " +
        "(Redis, job runs). Set KUMIKO_SECRETS_MASTER_KEY_V1 (and KUMIKO_SECRETS_MASTER_KEY_CURRENT_VERSION) " +
        "on the web and worker processes to seal them.",
    );
  }
  const configAccessorFactory =
    opts.configResolver && createConfigAccessorFactory(opts.registry, opts.configResolver);
  const deliveryService = createDeliveryService({
    db: opts.db,
    registry: opts.registry,
    channels: collectChannels(opts.registry),
    ...(opts.redis && { idempotencyRedis: opts.redis }),
    ...(opts.secrets && { secrets: opts.secrets }),
    ...(opts.addressCipher && { addressCipher: opts.addressCipher }),
    ...(opts.sseBroker && { sseBroker: opts.sseBroker }),
    ...(opts.escapeHatchAuditSink && { escapeHatchAuditSink: opts.escapeHatchAuditSink }),
    ...(opts.log && { log: opts.log }),
    ...(opts.tenantUserIdsQuery && { tenantUserIdsQuery: opts.tenantUserIdsQuery }),
    ...(opts.unsubscribeLinks && { unsubscribeLinks: opts.unsubscribeLinks }),
    ...(configAccessorFactory && {
      tenantConfigFor: (tenantId: TenantId) => {
        const systemUser = createSystemUser(tenantId);
        return configAccessorFactory({
          user: { id: systemUser.id, tenantId },
          db: createTenantDb({ db: opts.db, tenantId }),
          ...(opts.secrets && { secrets: opts.secrets }),
        });
      },
    }),
  });
  return createDeliveryNotifyFactory(deliveryService, {
    deliverQueuedInline: opts.deliverQueuedInline === true,
  });
}

function isLogger(value: unknown): value is Logger {
  if (typeof value !== "object" || value === null) return false;
  return (["info", "warn", "error", "debug", "child"] as const).every(
    (method) => method in value && typeof Reflect.get(value, method) === "function",
  );
}

// Prod context.log only comes from the app's extraContext.
export function loggerFromExtraContext(extraContext: Record<string, unknown>): Logger | undefined {
  const candidate = extraContext["log"];
  return isLogger(candidate) ? candidate : undefined;
}

function resolveEscapeHatchAuditSink(
  features: readonly FeatureDefinition[],
  db: DbConnection,
): EscapeHatchAuditSink | undefined {
  const hasAuditFeature = features.some((f) => f.name === AUDIT_FEATURE);
  return hasAuditFeature ? createEscapeHatchAuditSink({ db }) : undefined;
}

function resolveBootSecrets(
  db: DbConnection,
  features: readonly FeatureDefinition[],
  crypto: BootCrypto,
  registry: Registry,
): SecretsContext | undefined {
  const hasSecretsFeature = features.some((f) => f.name === SECRETS_FEATURE_NAME);
  if (!hasSecretsFeature || !crypto.masterKeyProvider) return undefined;
  return createSecretsContext({
    db,
    masterKeyProvider: crypto.masterKeyProvider,
    registry,
    dekCache: crypto.dekCache,
  });
}

function bootCryptoContext(crypto: BootCrypto): Record<string, unknown> {
  return {
    ...(crypto.masterKeyProvider && { masterKeyProvider: crypto.masterKeyProvider }),
    // Encrypt/decrypt partner for `encrypted: true` config keys. Wired
    // whenever a master key exists — NOT gated on the secrets feature,
    // config encryption must work without mounting ctx.secrets.
    ...(crypto.configCipher && { configEncryption: crypto.configCipher }),
  };
}

/** Config key (`feature:config:name`) to value; wins over the key's env variable. */
export type ConfigOverridesInput = Readonly<Record<string, string | number | boolean>>;

/** Env bridge first, validated app overrides on top: the one merge every boot function shares. */
export function buildConfigOverrides(
  registry: Registry,
  envSource: Record<string, string | undefined>,
  appOverrides: ConfigOverridesInput | undefined,
) {
  const envOverrides = buildEnvConfigOverrides(registry, envSource);
  return appOverrides
    ? new Map([...envOverrides, ...validateAppOverrides(registry, appOverrides)])
    : envOverrides;
}

function createBootConfigResolver(
  registry: Registry,
  envSource: Record<string, string | undefined>,
  crypto: BootCrypto,
  appOverrides: ConfigOverridesInput | undefined,
) {
  return createConfigResolver({
    appOverrides: buildConfigOverrides(registry, envSource, appOverrides),
    ...(crypto.configCipher && { cipher: crypto.configCipher }),
  });
}

// The delivery service reads tenant config too (tenant name/locale in mail
// layouts), so apps without auth still get a resolver for it; the ctx entry
// stays auth-only.
function resolveDeliveryConfigResolver(
  opts: {
    readonly hasAuth: boolean;
    readonly registry: Registry;
    readonly envSource: Record<string, string | undefined>;
    readonly appOverrides?: ConfigOverridesInput;
  },
  hasDeliveryFeature: boolean,
  crypto: BootCrypto,
): ReturnType<typeof createBootConfigResolver> | undefined {
  if (opts.hasAuth || hasDeliveryFeature) {
    return createBootConfigResolver(opts.registry, opts.envSource, crypto, opts.appOverrides);
  }
  if (opts.appOverrides) {
    throw new Error(
      "[runProdApp] appOverrides needs `auth` or a delivery feature: without one no config resolver is built and the overrides would be ignored.",
    );
  }
  return undefined;
}

type BootExtraContextOptions = {
  readonly db: DbConnection;
  readonly features: readonly FeatureDefinition[];
  readonly envSource: Record<string, string | undefined>;
  readonly registry: Registry;
  readonly hasAuth: boolean;
  // Resolved once per boot via resolveBootCrypto — shared by secrets,
  // config-resolver, config-set-handler and boot-seeds. Absent (tests
  // that don't care about encryption) ⇒ resolved from envSource here.
  readonly crypto?: BootCrypto;
  readonly masterKey?: MasterKeyProvider;
  readonly sseBroker?: SseBroker;
  /** Backs notify's idempotencyKey dedup; without it such a notify throws. */
  readonly redis?: Redis;
  readonly kms?: KmsAdapter;
  /** One-shot process (runBootstrap): nothing drains its job queue once it
   *  exits, so queued channels must send inline instead of enqueueing. */
  readonly deliverQueuedInline?: boolean;
  /** Receives redacted delivery failures; without it they go to the console. */
  readonly log?: Logger;
  /** Signs `unsubscribe: true` notifications' mail links; see runProdApp `unsubscribe`. */
  readonly unsubscribeLinks?: UnsubscribeLinkConfig;
  /** App-level config values (tenant model, branding, seo ...) above the env bridge. */
  readonly appOverrides?: ConfigOverridesInput;
};

function bootDeliveryContext(
  opts: BootExtraContextOptions,
  parts: {
    readonly crypto: BootCrypto;
    readonly secrets: SecretsContext | undefined;
    readonly escapeHatchAuditSink: EscapeHatchAuditSink | undefined;
    readonly configResolver: ConfigResolver | undefined;
  },
): Record<string, unknown> {
  if (!opts.features.some((f) => f.name === DELIVERY_FEATURE)) return {};
  const hasTenantFeature = opts.features.some((f) => f.name === TENANT_FEATURE);
  const { crypto, secrets, escapeHatchAuditSink } = parts;
  return {
    _notifyFactory: buildDeliveryNotifyFactory({
      db: opts.db,
      registry: opts.registry,
      ...(secrets && { secrets }),
      ...(crypto.configCipher && { addressCipher: crypto.configCipher }),
      ...(opts.sseBroker && { sseBroker: opts.sseBroker }),
      ...(opts.redis && { redis: opts.redis }),
      ...(escapeHatchAuditSink && { escapeHatchAuditSink }),
      ...(opts.log && { log: opts.log }),
      ...(hasTenantFeature && { tenantUserIdsQuery: TenantQueries.resolveUserIds }),
      configResolver: parts.configResolver,
      deliverQueuedInline: opts.deliverQueuedInline,
      unsubscribeLinks: opts.unsubscribeLinks,
    }),
  };
}

export function buildBootExtraContext(opts: BootExtraContextOptions): Record<string, unknown> {
  const crypto = opts.crypto ?? resolveBootCrypto(opts.envSource, opts.masterKey);
  const hasDeliveryFeature = opts.features.some((f) => f.name === DELIVERY_FEATURE);
  const escapeHatchAuditSink = resolveEscapeHatchAuditSink(opts.features, opts.db);
  const secrets = resolveBootSecrets(opts.db, opts.features, crypto, opts.registry);
  const bootConfigResolver = resolveDeliveryConfigResolver(opts, hasDeliveryFeature, crypto);
  const configResolver = opts.hasAuth ? bootConfigResolver : undefined;
  return {
    templateResolver: createTemplateResolverApi(opts.db, opts.registry),
    ...(opts.kms && { kms: opts.kms }),
    ...(escapeHatchAuditSink && { _escapeHatchAuditSink: escapeHatchAuditSink }),
    ...bootDeliveryContext(opts, {
      crypto,
      secrets,
      escapeHatchAuditSink,
      configResolver: bootConfigResolver,
    }),
    // Top-level provider so feature jobs (secrets rotate, config reencrypt)
    // reach it via ctx — previously only test-stack wired it.
    ...bootCryptoContext(crypto),
    ...(secrets && { secrets }),
    ...(configResolver && { configResolver }),
  };
}

// The auth.mail convenience block is normalized into the explicit
// passwordReset/emailVerification/signup/invite fields BEFORE buildComposeAuthOptions
// (feature-side: hmacSecret/mode) and the auth-routes fragment read them, so one mail
// block feeds both paths. Explicit app flows take precedence over the defaults.
// Without SMTP_HOST in the environment, nothing is wired; otherwise the reset and
// verification routes would return 500.
/** The auth fields read and normalized by resolveAuthMail; both
 *  app auth types (prod + dev) satisfy this structurally. */
type AuthMailNormalizable = {
  readonly mail?: AuthMailOptions;
  readonly passwordReset?: PasswordResetSetup;
  readonly emailVerification?: EmailVerificationSetup;
  readonly signup?: SignupSetup;
  readonly invite?: InviteSetup;
  readonly accountUnlock?: AccountUnlockSetup;
};

function buildAuthPathAppUrl(
  baseUrl: string,
  path: AuthPath,
): string | ((locale: string) => string) {
  return typeof path === "function"
    ? (locale: string) => `${baseUrl}${path(locale)}`
    : `${baseUrl}${path}`;
}

function backfillTokenSecrets<T extends AuthMailNormalizable>(auth: T, tokenSecret: string) {
  return {
    ...auth,
    ...(auth.passwordReset && {
      passwordReset: {
        ...auth.passwordReset,
        hmacSecret: auth.passwordReset.hmacSecret ?? tokenSecret,
      },
    }),
    ...(auth.emailVerification && {
      emailVerification: {
        ...auth.emailVerification,
        hmacSecret: auth.emailVerification.hmacSecret ?? tokenSecret,
      },
    }),
    ...(auth.accountUnlock && {
      accountUnlock: {
        ...auth.accountUnlock,
        hmacSecret: auth.accountUnlock.hmacSecret ?? tokenSecret,
      },
    }),
  };
}

export function resolveAuthMail<T extends AuthMailNormalizable>(
  auth: T,
  hmacSecret: string,
  envSource: Record<string, string | undefined>,
  mailWiring: { readonly mailConfigured?: boolean } = {},
): T & {
  readonly passwordReset?: PasswordResetOptions;
  readonly emailVerification?: EmailVerificationOptions;
  readonly accountUnlock?: AccountUnlockOptions;
} {
  // Runs before the mail/SMTP guards below so an app-supplied block without
  // hmacSecret is backfilled even without a `mail` block; an explicit secret still wins.
  const tokenSecret = auth.mail?.hmacSecret ?? hmacSecret;
  const withResolvedSecrets = backfillTokenSecrets(auth, tokenSecret);

  if (!auth.mail) return withResolvedSecrets;
  // SMTP-presence gate: without SMTP_HOST in the environment, no flow is wired
  // (the routes would otherwise return 500). Mail delivery itself runs through
  // delivery (channel-email), not this transport; it only detects whether mail is
  // configured.
  // An app transport from runProdApp's `mail` option replaces the probe.
  if (
    mailWiring.mailConfigured !== true &&
    !createSmtpTransportFromEnv(envSource, { fallbackFrom: auth.mail.from ?? "noreply@localhost" })
  ) {
    return withResolvedSecrets;
  }
  const paths = makeAuthPaths(auth.mail.paths);
  // appName/locale flow into all four flow options because they all send through delivery.
  const mailPresentation = {
    ...(auth.mail.appName !== undefined && { appName: auth.mail.appName }),
    ...(auth.mail.locale !== undefined && { locale: auth.mail.locale }),
  };
  return {
    ...withResolvedSecrets,
    passwordReset: withResolvedSecrets.passwordReset ?? {
      hmacSecret: tokenSecret,
      appUrl: buildAuthPathAppUrl(auth.mail.baseUrl, paths.resetPassword),
      ...mailPresentation,
    },
    emailVerification: withResolvedSecrets.emailVerification ?? {
      hmacSecret: tokenSecret,
      appUrl: buildAuthPathAppUrl(auth.mail.baseUrl, paths.verifyEmail),
      ...(auth.mail.emailVerificationMode !== undefined && {
        mode: auth.mail.emailVerificationMode,
      }),
      ...mailPresentation,
    },
    signup: withResolvedSecrets.signup ?? {
      appUrl: buildAuthPathAppUrl(auth.mail.baseUrl, paths.signupComplete),
      ...mailPresentation,
    },
    invite: withResolvedSecrets.invite ?? {
      appUrl: buildAuthPathAppUrl(auth.mail.baseUrl, paths.inviteAccept),
      ...mailPresentation,
    },
    // The login lockout is always on, so its escape hatch ships with the mail flows.
    accountUnlock: withResolvedSecrets.accountUnlock ?? {
      hmacSecret: tokenSecret,
      appUrl: buildAuthPathAppUrl(auth.mail.baseUrl, paths.unlockAccount),
      ...mailPresentation,
    },
  };
}

export async function buildProdSessionAuth(
  db: DbConnection,
  registry: Registry,
  sessionsFeature: FeatureDefinition | undefined,
  mfaFeature: FeatureDefinition | undefined,
  patFeature: FeatureDefinition | undefined,
): Promise<{
  readonly sessionCreator: Awaited<ReturnType<typeof resolveSessionStore>>["creator"];
  readonly sessionRevoker: Awaited<ReturnType<typeof resolveSessionStore>>["revoker"];
  readonly sessionChecker: Awaited<ReturnType<typeof resolveSessionStore>>["checker"];
}> {
  // Resolve the sessions feature sessionStore provider.
  const store = await resolveSessionStore({ db, registry });
  if (sessionsFeature) {
    bindAutoRevokeFromFeature(sessionsFeature)?.(store.massRevoker);
  }
  if (mfaFeature) {
    bindMfaRevokeAllOtherSessionsFromFeature(mfaFeature)?.(store.revokeAllOthers);
  }
  if (mfaFeature && patFeature) {
    bindRevokeAllPatTokensFromFeature(mfaFeature)?.((userId) =>
      revokeAllPatTokensForUser(db, userId),
    );
  }
  return {
    sessionCreator: store.creator,
    sessionRevoker: store.revoker,
    sessionChecker: store.checker,
  };
}

// Password-change → PAT-revoke, independent of sessions/MFA being mounted
// (unlike buildProdSessionAuth, which only runs when a sessionStore provider
// is registered). Call unconditionally whenever personal-access-tokens is
// mounted — a no-op if it isn't (bindPatAutoRevokeOnPasswordChangeFromFeature
// returns undefined for an unmounted feature.exports shape, but callers
// should still gate on patFeature being defined at all).
export function wireProdPatAutoRevoke(db: DbConnection, patFeature: FeatureDefinition): void {
  bindPatAutoRevokeOnPasswordChangeFromFeature(patFeature)?.((userId) =>
    revokeAllPatTokensForUser(db, userId),
  );
}
