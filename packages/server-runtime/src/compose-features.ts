// composeFeatures — single source of truth for the feature list that
// boot AND the schema generator see.
//
// Both runDevApp and runProdApp mix in the same bundled features in
// auth-mode (config + user + tenant + auth-email-password, plus
// auth-self-registration when authOptions.signup is set). So the
// drizzle schema generator sees the exact same feature list per app as
// the runtime, the composition lives here — both bootstrap wrappers AND
// each app's drizzle/generate.ts call it.
//
// Order: infrastructure features (config/user/tenant) first, then
// auth-email-password (+ auth-self-registration when authOptions.signup
// is set), then the app features. Later features may reference earlier
// ones (e.g. authClaims hooks on user/tenant).

import {
  type AccountLockoutOptions,
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
   *  (+ auth-self-registration when authOptions.signup is set) before the
   *  app features. Mirror of "auth-mode" in run{Dev,Prod}App. */
  readonly includeBundled: boolean;
  /** Optional auth-feature options passed through to
   *  createAuthEmailPasswordFeature. When passwordReset / emailVerification
   *  are set here, the feature registers the request/confirm handlers —
   *  otherwise it doesn't (500 if the routes are mounted via
   *  auth-routes.ts but no handler dispatches). Goes hand-in-hand with the
   *  passwordReset block in RunProdAppAuthOptions / RunDevAppAuthOptions. */
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
    // inviteScreen mirrors authOptions.invite: that's the exact option that
    // makes auth-email-password register the invite-create write-handler
    // the /members invite drawer is bound to — without this, includeBundled
    // apps that DO configure invite still get /members with no invite button.
    createTenantFeature({ inviteScreen: Boolean(authOptions?.invite) }),
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

/** Shape of any run{Prod,Dev}App auth block that can carry a
 *  passwordReset/emailVerification config. The wrapper API
 *  (PasswordResetSetup) extends the feature API (PasswordResetOptions), so
 *  a structural-typed lookup on the auth-only subset is enough. Lets
 *  buildComposeAuthOptions be called with both RunProd- and
 *  RunDev-AuthOptions without building the helper twice. */
export type AuthOptionsCarrier = {
  readonly passwordReset?: PasswordResetOptions;
  readonly emailVerification?: EmailVerificationOptions;
  readonly signup?: SignupOptions;
  readonly invite?: InviteOptions;
  readonly accountUnlock?: AccountUnlockOptions;
  readonly accountLockout?: AccountLockoutOptions;
};

/** Builds the authOptions block for composeFeatures from a wrapper auth
 *  block. Passes through ONLY the feature-side fields (hmacSecret,
 *  tokenTtlMinutes, mode) — the mail side (sendResetEmail/appResetUrl)
 *  belongs in the auth-routes config and is wired separately by the
 *  wrapper.
 *
 *  Returns undefined when neither passwordReset nor emailVerification is
 *  set (composeFeatures default-deny: NO handler registered in the
 *  registry, /api/auth/request-password-reset etc. stay 401/404). */
// appUrl is generic per call site: reset/verify/invite stay plain strings,
// signup alone allows the `(locale) => string` form (language-in-path apps —
// see SignupRequestOptions.appUrl). A shared non-generic type here would
// force every flow to the widest shape, breaking the narrower ones.
type MailFlowFields<TAppUrl extends string | ((locale: string) => string) = string> = {
  readonly appUrl: TAppUrl;
  readonly tokenTtlMinutes?: number;
  readonly appName?: string;
  readonly locale?: AuthMailLocale;
};

// The magic-link mail fields shared by all four flows. Conditional spreads omit
// undefined keys (exactOptionalPropertyTypes) and avoid the property-write that
// trips noPropertyAccessFromIndexSignature on the type-aliased option shapes.
// reset/verify layer hmacSecret (+ mode) on top.
function pickMailFields<TAppUrl extends string | ((locale: string) => string)>(
  src: MailFlowFields<TAppUrl>,
): MailFlowFields<TAppUrl> {
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
  if (auth.accountLockout) {
    opts.accountLockout = auth.accountLockout;
  }
  return hasAnyAuthFlow(opts) ? opts : undefined;
}

function hasAnyAuthFlow(opts: AuthEmailPasswordOptions): boolean {
  return Object.values(opts).some(Boolean);
}
