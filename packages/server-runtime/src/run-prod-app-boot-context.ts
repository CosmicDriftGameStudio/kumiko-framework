import {
  AUDIT_FEATURE,
  createEscapeHatchAuditSink,
} from "@cosmicdrift/kumiko-bundled-features/audit";
import {
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
  AuthMailOptions,
  EmailVerificationSetup,
  InviteSetup,
  PasswordResetSetup,
  SignupSetup,
} from "./run-prod-app.ts";

// Boot-time context helpers for runProdApp: ctx-extra-context wiring
// (templateResolver/delivery/secrets/config-resolver), auth-mail convenience
// normalization, and prod session-auth wiring. Split out of run-prod-app.ts
// (#1005, Welle 2) — mechanical relocation, these are self-contained pure
// functions, no closure over runProdApp's local boot state.

// Shared with runDevApp (mergeConfigResolverDefault) for dev/prod parity.
export function addConfigAccessorFactory<T extends { readonly configResolver?: ConfigResolver }>(
  resolved: T,
  registry: Registry,
): T {
  if (!resolved.configResolver) return resolved;
  // Both keys, always overriding an app-supplied value: the factory must derive from the
  // effective resolver (fw#3313); the underscore alias stays until the next major.
  const configAccessorFactory = createConfigAccessorFactory(registry, resolved.configResolver);
  return {
    ...resolved,
    configAccessorFactory,
    _configAccessorFactory: configAccessorFactory,
  };
}

// Framework-Default-Provider für den AppContext — gleicher Mechanismus wie
// der tenantTierResolver-Autowire (findTierResolverUsage): deklarierter
// Bedarf (Feature gemountet) → Default aus db/env, App überschreibt nur die
// Ausnahme. templateResolver ist unbedingt (createTemplateResolverApi wirft nie, baut
// nur einen db-gebundenen Accessor). secrets wird nur auto-verdrahtet wenn
// das secrets-Feature gemountet ist UND ein KEK tatsächlich verfügbar ist
// (masterKey-Override ODER env-KEK present) — sonst skip, damit der eager
// KEK-Detection + Provider/Cipher-Aufbau leben in boot/boot-crypto.ts
// (envHasMasterKek, resolveBootCrypto) — gemeinsam mit runDevApp.
// Prod-Misconfig (secrets gemountet, kein KEK) fängt schon secretsEnvSchema
// beim Boot; fehlt der env-Schema-Pfad, wirft requireSecretsContext beim
// ersten ctx.secrets-Zugriff mit Wiring-Hinweis. configResolver nur im
// Auth-Mode. Exportiert + pure für Unit-Tests; der merge mit App-Werten
// passiert beim Caller (App gewinnt).

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

function createBootConfigResolver(
  registry: Registry,
  envSource: Record<string, string | undefined>,
  crypto: BootCrypto,
  appOverrides: ConfigOverridesInput | undefined,
) {
  const envOverrides = buildEnvConfigOverrides(registry, envSource);
  return createConfigResolver({
    appOverrides: appOverrides
      ? new Map([...envOverrides, ...validateAppOverrides(registry, appOverrides)])
      : envOverrides,
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
  return opts.hasAuth || hasDeliveryFeature
    ? createBootConfigResolver(opts.registry, opts.envSource, crypto, opts.appOverrides)
    : undefined;
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

// auth.mail-Convenience → normalisiert in die expliziten passwordReset/
// emailVerification/signup/invite-Felder, BEVOR buildComposeAuthOptions
// (Feature-Side: hmacSecret/mode) und das auth-routes-Fragment sie lesen —
// so speist EIN mail-Block beide Pfade. App-explizite Flows gewinnen über
// den Default. Null-Transport-Guard: ohne SMTP_HOST-env bleibt alles
// unverdrahtet (sonst lieferten die reset/verify-Routes 500).
/** Die Auth-Felder die resolveAuthMail liest/normalisiert — beide
 *  App-Auth-Typen (prod + dev) erfüllen das strukturell. */
type AuthMailNormalizable = {
  readonly mail?: AuthMailOptions;
  readonly passwordReset?: PasswordResetSetup;
  readonly emailVerification?: EmailVerificationSetup;
  readonly signup?: SignupSetup;
  readonly invite?: InviteSetup;
};

function buildAuthPathAppUrl(
  baseUrl: string,
  path: AuthPath,
): string | ((locale: string) => string) {
  return typeof path === "function"
    ? (locale: string) => `${baseUrl}${path(locale)}`
    : `${baseUrl}${path}`;
}

// accountUnlock (#1266) deliberately does NOT join this convenience block —
// unlike reset/verify/signup/invite it's only meaningful paired with
// `accountLockout` (kumiko-framework#1627), and apps set both explicitly
// alongside each other (same shape as `passwordReset`), so `mail` alone
// can't silently expose a new public endpoint an app didn't ask for.

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
} {
  // Runs before the mail/SMTP guards below so an app-supplied block without
  // hmacSecret is backfilled even without a `mail` block; an explicit secret still wins.
  const tokenSecret = auth.mail?.hmacSecret ?? hmacSecret;
  const withResolvedSecrets = backfillTokenSecrets(auth, tokenSecret);

  if (!auth.mail) return withResolvedSecrets;
  // SMTP-presence gate: ohne SMTP_HOST-env wird KEIN Flow verdrahtet (Routes
  // blieben sonst 500). Der eigentliche Mail-Versand läuft über delivery
  // (channel-email), nicht über diesen Transport — er ist nur der Detektor
  // "ist Mail konfiguriert?".
  // An app transport from runProdApp's `mail` option replaces the probe.
  if (
    mailWiring.mailConfigured !== true &&
    !createSmtpTransportFromEnv(envSource, { fallbackFrom: auth.mail.from ?? "noreply@localhost" })
  ) {
    return withResolvedSecrets;
  }
  const paths = makeAuthPaths(auth.mail.paths);
  // appName/locale fließen in alle vier Flow-Options (alle mailen via delivery).
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
  // Resolve the sessions feature sessionStore provider (#1372).
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
