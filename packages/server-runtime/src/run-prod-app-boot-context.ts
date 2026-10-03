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
} from "@cosmicdrift/kumiko-bundled-features/config";
import {
  collectChannels,
  createDeliveryService,
  DELIVERY_FEATURE,
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
import type { SseBroker } from "@cosmicdrift/kumiko-framework/api";
import type { KmsAdapter } from "@cosmicdrift/kumiko-framework/crypto";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import type {
  ConfigResolver,
  EscapeHatchAuditSink,
  FeatureDefinition,
  NotifyFactory,
  Registry,
} from "@cosmicdrift/kumiko-framework/engine";
import type { MasterKeyProvider } from "@cosmicdrift/kumiko-framework/secrets";
import { type BootCrypto, resolveBootCrypto } from "./boot/boot-crypto.js";
import type {
  AuthMailOptions,
  EmailVerificationSetup,
  InviteSetup,
  PasswordResetSetup,
  SignupSetup,
} from "./run-prod-app.js";

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
  return {
    ...resolved,
    _configAccessorFactory: createConfigAccessorFactory(registry, resolved.configResolver),
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
// inline, with `secrets` for chat-channel credentials.
function buildDeliveryNotifyFactory(opts: {
  readonly db: DbConnection;
  readonly registry: Registry;
  readonly secrets?: SecretsContext;
  readonly sseBroker?: SseBroker;
  readonly escapeHatchAuditSink?: EscapeHatchAuditSink;
  readonly deliverQueuedInline: boolean | undefined;
}): NotifyFactory {
  const deliveryService = createDeliveryService({
    db: opts.db,
    registry: opts.registry,
    channels: collectChannels(opts.registry),
    ...(opts.secrets && { secrets: opts.secrets }),
    ...(opts.sseBroker && { sseBroker: opts.sseBroker }),
    ...(opts.escapeHatchAuditSink && { escapeHatchAuditSink: opts.escapeHatchAuditSink }),
  });
  return (user, tenantId, jobDispatcher) => (notificationType, options) =>
    deliveryService.notify(
      notificationType,
      options,
      user,
      tenantId,
      opts.deliverQueuedInline === true ? undefined : jobDispatcher,
    );
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
): SecretsContext | undefined {
  const hasSecretsFeature = features.some((f) => f.name === SECRETS_FEATURE_NAME);
  if (!hasSecretsFeature || !crypto.masterKeyProvider) return undefined;
  return createSecretsContext({
    db,
    masterKeyProvider: crypto.masterKeyProvider,
    dekCache: crypto.dekCache,
  });
}

export function buildBootExtraContext(opts: {
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
  readonly kms?: KmsAdapter;
  /** One-shot process (runBootstrap): nothing drains its job queue once it
   *  exits, so queued channels must send inline instead of enqueueing. */
  readonly deliverQueuedInline?: boolean;
}): Record<string, unknown> {
  const crypto = opts.crypto ?? resolveBootCrypto(opts.envSource, opts.masterKey);
  const hasDeliveryFeature = opts.features.some((f) => f.name === DELIVERY_FEATURE);
  const escapeHatchAuditSink = resolveEscapeHatchAuditSink(opts.features, opts.db);
  const secrets = resolveBootSecrets(opts.db, opts.features, crypto);
  return {
    templateResolver: createTemplateResolverApi(opts.db),
    ...(opts.kms && { kms: opts.kms }),
    ...(escapeHatchAuditSink && { _escapeHatchAuditSink: escapeHatchAuditSink }),
    ...(hasDeliveryFeature && {
      _notifyFactory: buildDeliveryNotifyFactory({
        db: opts.db,
        registry: opts.registry,
        ...(secrets && { secrets }),
        ...(opts.sseBroker && { sseBroker: opts.sseBroker }),
        ...(escapeHatchAuditSink && { escapeHatchAuditSink }),
        deliverQueuedInline: opts.deliverQueuedInline,
      }),
    }),
    // Top-level provider so feature jobs (secrets rotate, config reencrypt)
    // reach it via ctx — previously only test-stack wired it.
    ...(crypto.masterKeyProvider && { masterKeyProvider: crypto.masterKeyProvider }),
    // Encrypt/decrypt partner for `encrypted: true` config keys. Wired
    // whenever a master key exists — NOT gated on the secrets feature,
    // config encryption must work without mounting ctx.secrets.
    ...(crypto.configCipher && { configEncryption: crypto.configCipher }),
    ...(secrets && { secrets }),
    ...(opts.hasAuth && {
      configResolver: createConfigResolver({
        appOverrides: buildEnvConfigOverrides(opts.registry, opts.envSource),
        ...(crypto.configCipher && { cipher: crypto.configCipher }),
      }),
    }),
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
  if (
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
