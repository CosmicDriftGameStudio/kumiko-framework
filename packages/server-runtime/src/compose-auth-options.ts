import type {
  AccountLockoutOptions,
  AccountUnlockOptions,
  AuthEmailPasswordOptions,
  AuthMailLocale,
  EmailVerificationOptions,
  InviteOptions,
  PasswordResetOptions,
  SignupOptions,
} from "@cosmicdrift/kumiko-bundled-features/auth-email-password";

/** Shape of any run{Prod,Dev}App auth block that can carry a
 *  passwordReset/emailVerification config, once resolveAuthMail has resolved
 *  the wrapper's optional hmacSecret into the feature API's required one —
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
// All five magic-link flows (reset/verify/signup/invite/unlock) accept the
// same appUrl shape — a plain string, or a `(locale) => string` function for
// apps with language-in-path routing (see SignupRequestOptions.appUrl).
type MailFlowFields = {
  readonly appUrl: string | ((locale: string) => string);
  readonly tokenTtlMinutes?: number;
  readonly appName?: string;
  readonly locale?: AuthMailLocale;
};

// The magic-link mail fields shared by all five flows. Conditional spreads omit
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
  if (auth.accountLockout) {
    opts.accountLockout = auth.accountLockout;
  }
  return hasAnyAuthFlow(opts) ? opts : undefined;
}

function hasAnyAuthFlow(opts: AuthEmailPasswordOptions): boolean {
  return Object.values(opts).some(Boolean);
}
