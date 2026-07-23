// composeFeatures — single source of truth für die Feature-Liste die
// Boot UND Schema-Generator sehen.
//
// Sowohl runDevApp als auch runProdApp mischen im auth-mode dieselben
// vier Bundled-Features dazu (config + user + tenant + auth-email-pw).
// Damit der drizzle-Schema-Generator pro App genau dieselbe Feature-
// Liste sieht wie die Runtime, leben die Komposition hier — beide
// Bootstrap-Wrapper UND der per-app drizzle/generate.ts rufen sie auf.
//
// Reihenfolge: Infrastruktur-Features (config/user/tenant) zuerst, dann
// auth-email-password, dann die App-Features. Spätere Features dürfen
// auf Frühere referenzieren (z.B. authClaims-Hooks an user/tenant).

import {
  type AccountUnlockOptions,
  type AuthEmailPasswordOptions,
  type AuthMailLocale,
  createAuthEmailPasswordFeature,
  createAuthSelfRegistrationToggleFeature,
  type EmailVerificationOptions,
  type InviteOptions,
  type PasswordResetOptions,
  type SignupOptions,
} from "@cosmicdrift/kumiko-bundled-features/auth-email-password";
import {
  AUTH_MFA_FEATURE,
  mfaStatusCheckerFromFeature,
} from "@cosmicdrift/kumiko-bundled-features/auth-mfa";
import { createConfigFeature } from "@cosmicdrift/kumiko-bundled-features/config";
import { createTenantFeature } from "@cosmicdrift/kumiko-bundled-features/tenant";
import { createUserFeature } from "@cosmicdrift/kumiko-bundled-features/user";
import type { FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";

export type ComposeFeaturesOptions = {
  /** When true, prepends config + user + tenant + auth-email-password
   *  before the app features. Mirror of "auth-mode" in run{Dev,Prod}App. */
  readonly includeBundled: boolean;
  /** Optional auth-feature-options durchgereicht an
   *  createAuthEmailPasswordFeature. Wenn passwordReset / emailVerification
   *  hier gesetzt sind, registriert das Feature die request-/confirm-
   *  Handler — sonst NICHT (500 wenn die routes via auth-routes.ts
   *  gemounted sind aber kein Handler dispatcht). Hand-in-hand mit dem
   *  passwordReset-Block in RunProdAppAuthOptions / RunDevAppAuthOptions. */
  readonly authOptions?: AuthEmailPasswordOptions;
};

export function composeFeatures(
  appFeatures: readonly FeatureDefinition[],
  options: ComposeFeaturesOptions,
): FeatureDefinition[] {
  // ponytail: includeBundled:false skips the auth-mfa auto-wiring below —
  // an app composing its own foundation and mounting auth-mfa itself is
  // responsible for threading mfaStatusCheckerFromFeature(...) into its
  // own createAuthEmailPasswordFeature(...) call, or login silently
  // bypasses MFA. Upgrade if this trips someone: warn here when appFeatures
  // contains AUTH_MFA_FEATURE but includeBundled is false.
  if (!options.includeBundled) return [...appFeatures];

  // Bundled foundation goes first so its instances carry the runDevApp /
  // runProdApp `authOptions` (passwordReset wiring etc.). App-features that
  // ALSO declare one of these names — e.g. the create-kumiko-app picker
  // hands back `createAuthEmailPasswordFeature()` because the user ticked
  // it — would otherwise crash createRegistry with "Duplicate feature".
  // Drop the app-side duplicates and warn so the user can clean run-config.
  //
  // auth-mfa is NOT part of the bundled foundation (apps opt in explicitly
  // via APP_FEATURES) — but if it's there, the login handler needs its
  // status-checker wired in at construction time, since createAuthEmail-
  // PasswordFeature is built right here, before the caller ever sees it.
  const mfaFeature = appFeatures.find((f) => f.name === AUTH_MFA_FEATURE);
  const authOptions = mfaFeature
    ? { ...options.authOptions, mfaStatusChecker: mfaStatusCheckerFromFeature(mfaFeature) }
    : options.authOptions;
  const bundled = [
    createConfigFeature(),
    createUserFeature(),
    createTenantFeature(),
    createAuthEmailPasswordFeature(authOptions ?? {}),
    // signup-request/signup-confirm are registered whenever authOptions.signup
    // is set (see above), but the handler itself no-ops unless the companion
    // toggle feature is mounted (ctx.hasFeature(AUTH_SELF_REGISTRATION_FEATURE))
    // — without this, apps using the includeBundled convenience path get
    // self-signup silently broken (always-200 anti-enumeration contract masks
    // it as success). Mount it alongside signup, default ON, matching the
    // "on unless an operator flips it off at runtime" contract.
    ...(authOptions?.signup !== undefined ? [createAuthSelfRegistrationToggleFeature()] : []),
  ];
  const bundledNames = new Set(bundled.map((f) => f.name));
  const filteredApp: FeatureDefinition[] = [];
  for (const f of appFeatures) {
    if (bundledNames.has(f.name)) {
      // biome-ignore lint/suspicious/noConsole: boot-time UX warning
      console.warn(
        `[composeFeatures] "${f.name}" already auto-mounted via includeBundled — dropping the explicit copy from APP_FEATURES. Remove it from run-config.ts to silence this warning.`,
      );
      continue;
    }
    filteredApp.push(f);
  }
  return [...bundled, ...filteredApp];
}

/** Shape eines beliebigen run{Prod,Dev}App-Auth-Blocks der eine
 *  PasswordReset/EmailVerification-Konfiguration tragen kann. Die
 *  Wrapper-API (PasswordResetSetup) extends die Feature-API
 *  (PasswordResetOptions), darum reicht ein structural-typed
 *  Lookup auf den auth-only-Subset. Erlaubt buildComposeAuthOptions
 *  mit RunProd- UND RunDev-AuthOptions zu callen ohne den Helper
 *  doppelt zu bauen. */
export type AuthOptionsCarrier = {
  readonly passwordReset?: PasswordResetOptions;
  readonly emailVerification?: EmailVerificationOptions;
  readonly signup?: SignupOptions;
  readonly invite?: InviteOptions;
  readonly accountUnlock?: AccountUnlockOptions;
};

/** Baut den authOptions-Block für composeFeatures aus einem
 *  Wrapper-Auth-Block. Reicht NUR die feature-side-Felder
 *  (hmacSecret, tokenTtlMinutes, mode) durch — die mail-side
 *  (sendResetEmail/appResetUrl) gehört in die auth-routes-config
 *  und wird vom Wrapper separat verdrahtet.
 *
 *  Returnt undefined wenn weder passwordReset noch emailVerification
 *  gesetzt sind (composeFeatures default-deny: KEINE handler in der
 *  Registry registriert, /api/auth/request-password-reset etc. bleiben
 *  401/404). */
type MailFlowFields = {
  readonly appUrl: string;
  readonly tokenTtlMinutes?: number;
  readonly appName?: string;
  readonly locale?: AuthMailLocale;
};

// The magic-link mail fields shared by all four flows. Conditional spreads omit
// undefined keys (exactOptionalPropertyTypes) and avoid the property-write that
// trips noPropertyAccessFromIndexSignature on the type-aliased option shapes.
// reset/verify layer hmacSecret (+ mode) on top.
function pickMailFields(src: MailFlowFields): MailFlowFields {
  return {
    appUrl: src.appUrl,
    ...(src.tokenTtlMinutes !== undefined && { tokenTtlMinutes: src.tokenTtlMinutes }),
    ...(src.appName !== undefined && { appName: src.appName }),
    ...(src.locale !== undefined && { locale: src.locale }),
  };
}

export function buildComposeAuthOptions(
  auth: AuthOptionsCarrier | undefined,
): AuthEmailPasswordOptions | undefined {
  if (!auth) return undefined;
  const opts: { -readonly [K in keyof AuthEmailPasswordOptions]: AuthEmailPasswordOptions[K] } = {};
  if (auth.passwordReset) {
    opts.passwordReset = {
      hmacSecret: auth.passwordReset.hmacSecret,
      ...pickMailFields(auth.passwordReset),
    };
  }
  if (auth.emailVerification) {
    opts.emailVerification = {
      hmacSecret: auth.emailVerification.hmacSecret,
      ...pickMailFields(auth.emailVerification),
      ...(auth.emailVerification.mode !== undefined && { mode: auth.emailVerification.mode }),
    };
  }
  if (auth.signup) {
    opts.signup = pickMailFields(auth.signup);
  }
  if (auth.invite) {
    opts.invite = pickMailFields(auth.invite);
  }
  if (auth.accountUnlock) {
    opts.accountUnlock = {
      hmacSecret: auth.accountUnlock.hmacSecret,
      ...pickMailFields(auth.accountUnlock),
    };
  }
  return opts.passwordReset ||
    opts.emailVerification ||
    opts.signup ||
    opts.invite ||
    opts.accountUnlock
    ? opts
    : undefined;
}
