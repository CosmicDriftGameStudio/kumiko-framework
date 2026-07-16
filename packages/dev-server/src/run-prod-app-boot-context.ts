import { makeAuthPaths } from "@cosmicdrift/kumiko-bundled-features/auth-email-password";
import { bindMfaRevokeAllOtherSessionsFromFeature } from "@cosmicdrift/kumiko-bundled-features/auth-mfa";
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
  createSecretsContext,
  SECRETS_FEATURE_NAME,
} from "@cosmicdrift/kumiko-bundled-features/secrets";
import {
  bindAutoRevokeFromFeature,
  createSessionCallbacks,
} from "@cosmicdrift/kumiko-bundled-features/sessions";
import { createTextContentApi } from "@cosmicdrift/kumiko-bundled-features/text-content";
import type { SseBroker } from "@cosmicdrift/kumiko-framework/api";
import type { KmsAdapter } from "@cosmicdrift/kumiko-framework/crypto";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import type {
  ConfigResolver,
  FeatureDefinition,
  NotifyFactory,
  Registry,
} from "@cosmicdrift/kumiko-framework/engine";
import type { MasterKeyProvider } from "@cosmicdrift/kumiko-framework/secrets";
import { type BootCrypto, resolveBootCrypto } from "./boot/boot-crypto";
import type {
  AuthMailOptions,
  EmailVerificationSetup,
  InviteSetup,
  PasswordResetSetup,
  SignupSetup,
} from "./run-prod-app";
import type { ProdSessionsConfig } from "./session-wiring";

// Boot-time context helpers for runProdApp: ctx-extra-context wiring
// (textContent/delivery/secrets/config-resolver), auth-mail convenience
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
// Ausnahme. textContent ist unbedingt (createTextContentApi wirft nie, baut
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
// need it, in-app SSE does); no jobRunner → queued channels send inline.
function buildDeliveryNotifyFactory(opts: {
  readonly db: DbConnection;
  readonly registry: Registry;
  readonly sseBroker?: SseBroker;
}): NotifyFactory {
  const deliveryService = createDeliveryService({
    db: opts.db,
    registry: opts.registry,
    channels: collectChannels(opts.registry),
    ...(opts.sseBroker && { sseBroker: opts.sseBroker }),
  });
  return (user, tenantId) => (notificationType, options) =>
    deliveryService.notify(notificationType, options, user, tenantId);
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
}): Record<string, unknown> {
  const crypto = opts.crypto ?? resolveBootCrypto(opts.envSource, opts.masterKey);
  const hasSecretsFeature = opts.features.some((f) => f.name === SECRETS_FEATURE_NAME);
  const wireSecrets = hasSecretsFeature && crypto.masterKeyProvider !== undefined;
  const hasDeliveryFeature = opts.features.some((f) => f.name === DELIVERY_FEATURE);
  return {
    textContent: createTextContentApi(opts.db),
    ...(opts.kms && { kms: opts.kms }),
    ...(hasDeliveryFeature && {
      _notifyFactory: buildDeliveryNotifyFactory({
        db: opts.db,
        registry: opts.registry,
        ...(opts.sseBroker && { sseBroker: opts.sseBroker }),
      }),
    }),
    // Top-level provider so feature jobs (secrets rotate, config reencrypt)
    // reach it via ctx — previously only test-stack wired it.
    ...(crypto.masterKeyProvider && { masterKeyProvider: crypto.masterKeyProvider }),
    // Encrypt/decrypt partner for `encrypted: true` config keys. Wired
    // whenever a master key exists — NOT gated on the secrets feature,
    // config encryption must work without mounting ctx.secrets.
    ...(crypto.configCipher && { configEncryption: crypto.configCipher }),
    ...(wireSecrets &&
      crypto.masterKeyProvider && {
        secrets: createSecretsContext({
          db: opts.db,
          masterKeyProvider: crypto.masterKeyProvider,
          dekCache: crypto.dekCache,
        }),
      }),
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

export function resolveAuthMail<T extends AuthMailNormalizable>(
  auth: T,
  hmacSecret: string,
  envSource: Record<string, string | undefined>,
): T {
  if (!auth.mail) return auth;
  // SMTP-presence gate: ohne SMTP_HOST-env wird KEIN Flow verdrahtet (Routes
  // blieben sonst 500). Der eigentliche Mail-Versand läuft über delivery
  // (channel-email), nicht über diesen Transport — er ist nur der Detektor
  // "ist Mail konfiguriert?".
  if (
    !createSmtpTransportFromEnv(envSource, { fallbackFrom: auth.mail.from ?? "noreply@localhost" })
  ) {
    return auth;
  }
  const paths = makeAuthPaths(auth.mail.paths);
  // appName/locale fließen in alle vier Flow-Options (alle mailen via delivery).
  const mailPresentation = {
    ...(auth.mail.appName !== undefined && { appName: auth.mail.appName }),
    ...(auth.mail.locale !== undefined && { locale: auth.mail.locale }),
  };
  return {
    ...auth,
    passwordReset: auth.passwordReset ?? {
      hmacSecret,
      appUrl: `${auth.mail.baseUrl}${paths.resetPassword}`,
      ...mailPresentation,
    },
    emailVerification: auth.emailVerification ?? {
      hmacSecret,
      appUrl: `${auth.mail.baseUrl}${paths.verifyEmail}`,
      ...(auth.mail.emailVerificationMode !== undefined && {
        mode: auth.mail.emailVerificationMode,
      }),
      ...mailPresentation,
    },
    signup: auth.signup ?? {
      appUrl: `${auth.mail.baseUrl}${paths.signupComplete}`,
      ...mailPresentation,
    },
    invite: auth.invite ?? {
      appUrl: `${auth.mail.baseUrl}${paths.inviteAccept}`,
      ...mailPresentation,
    },
  };
}

export function buildProdSessionAuth(
  db: DbConnection,
  opts: ProdSessionsConfig,
  sessionsFeature: FeatureDefinition | undefined,
  mfaFeature: FeatureDefinition | undefined,
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
  // Secure-by-default: password-change/-reset mass-revokes the user's live
  // sessions without the app opting in via autoRevokeOnPasswordChange.
  if (sessionsFeature) {
    bindAutoRevokeFromFeature(sessionsFeature)?.(cbs.sessionMassRevoker);
  }
  // MFA enable/disable/regenerate mass-revokes every OTHER live session
  // (stolen-session defense) — only wired when auth-mfa is mounted.
  if (mfaFeature) {
    bindMfaRevokeAllOtherSessionsFromFeature(mfaFeature)?.(cbs.sessionRevokeAllOthers);
  }
  return {
    sessionCreator: cbs.sessionCreator,
    sessionRevoker: cbs.sessionRevoker,
    sessionChecker: cbs.sessionChecker,
    sessionStrictMode: true,
  };
}
