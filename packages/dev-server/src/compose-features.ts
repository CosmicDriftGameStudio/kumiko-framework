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
  type AuthEmailPasswordOptions,
  createAuthEmailPasswordFeature,
  type EmailVerificationOptions,
  type InviteOptions,
  type PasswordResetOptions,
  type SignupOptions,
} from "@cosmicdrift/kumiko-bundled-features/auth-email-password";
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
  return options.includeBundled
    ? [
        createConfigFeature(),
        createUserFeature(),
        createTenantFeature(),
        createAuthEmailPasswordFeature(options.authOptions ?? {}),
        ...appFeatures,
      ]
    : [...appFeatures];
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
export function buildComposeAuthOptions(
  auth: AuthOptionsCarrier | undefined,
): AuthEmailPasswordOptions | undefined {
  if (!auth) return undefined;
  const opts: { -readonly [K in keyof AuthEmailPasswordOptions]: AuthEmailPasswordOptions[K] } = {};
  if (auth.passwordReset) {
    const reset: { -readonly [K in keyof PasswordResetOptions]: PasswordResetOptions[K] } = {
      hmacSecret: auth.passwordReset.hmacSecret,
    };
    if (auth.passwordReset.tokenTtlMinutes !== undefined) {
      reset.tokenTtlMinutes = auth.passwordReset.tokenTtlMinutes;
    }
    opts.passwordReset = reset;
  }
  if (auth.emailVerification) {
    const verify: { -readonly [K in keyof EmailVerificationOptions]: EmailVerificationOptions[K] } =
      {
        hmacSecret: auth.emailVerification.hmacSecret,
      };
    if (auth.emailVerification.tokenTtlMinutes !== undefined) {
      verify.tokenTtlMinutes = auth.emailVerification.tokenTtlMinutes;
    }
    if (auth.emailVerification.mode !== undefined) {
      verify.mode = auth.emailVerification.mode;
    }
    opts.emailVerification = verify;
  }
  if (auth.signup) {
    // Plain object statt mapped-type — SignupOptions ist type-alias auf
    // SignupRequestOptions, der TS-mapped-type-Pfad löst's als
    // index-signature auf (TS noPropertyAccessFromIndexSignature klagt
    // dann beim Property-write). Plain shape ist klar UND funktioniert.
    const signup: { tokenTtlMinutes?: number } = {};
    if (auth.signup.tokenTtlMinutes !== undefined) {
      signup.tokenTtlMinutes = auth.signup.tokenTtlMinutes;
    }
    opts.signup = signup;
  }
  if (auth.invite) {
    // Plain object analog signup (gleicher type-alias-issue).
    const invite: { tokenTtlMinutes?: number } = {};
    if (auth.invite.tokenTtlMinutes !== undefined) {
      invite.tokenTtlMinutes = auth.invite.tokenTtlMinutes;
    }
    opts.invite = invite;
  }
  return opts.passwordReset || opts.emailVerification || opts.signup || opts.invite
    ? opts
    : undefined;
}
