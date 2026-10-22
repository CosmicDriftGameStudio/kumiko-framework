// Login handler reason codes map 1:1 to i18n keys (reasonToI18nKey): a new
// reason code needs a bundle entry plus a line in that mapping.

import {
  prependBasePath,
  useBasePath,
  useOptionalDispatcher,
  usePrimitives,
  useQuery,
  useTranslation,
} from "@cosmicdrift/kumiko-renderer";
import { type FormEvent, type ReactNode, useState } from "react";
import {
  type KnownLoginFailureReason,
  type LoginFailure,
  requestEmailVerification,
} from "./auth-client.ts";
import { AuthCard } from "./auth-form-primitives.tsx";
import { DEFAULT_AUTH_PATHS, DEFAULT_FORGOT_PASSWORD_PATH } from "./auth-paths.ts";
import { followNextOrLandingAfterLogin } from "./auth-redirect.ts";
import { AuthQueries } from "./constants.ts";
import { useSession } from "./session.tsx";

// Resend state for the confirmation mail offered under the error banner on reason=email_not_verified.
type ResendStatus =
  | { readonly kind: "idle" }
  | { readonly kind: "sending" }
  | { readonly kind: "success" }
  | { readonly kind: "rateLimited" }
  | { readonly kind: "error" };

export type AuthLegalLink = {
  readonly label: string;
  readonly href: string;
};

export type LoginScreenProps = {
  /** Overrides the `auth.login.title` key; only for a branded title that needs no translation. */
  readonly title?: string;
  readonly subtitle?: ReactNode;
  readonly submitLabel?: string;
  /** Href of the "Forgot password?" link under the submit button. Unset: the
   *  default path once the server offers the reset flow (login-options);
   *  `null` hides the link deliberately. */
  readonly forgotPasswordHref?: string | null;
  /** Optional href to RequestAccountUnlockScreen. When set, an
   *  account_locked login error renders an "Unlock account?" link inline —
   *  the account-lockout escape hatch, since forgotPasswordHref does NOT
   *  help here: the lockout gate blocks login before password verify even
   *  runs, so it also blocks the post-reset login. Apps without
   *  accountUnlock configured just leave this unset. Unset: default path once
   *  the server offers the flow (login-options); `null` = deliberately no link. */
  readonly unlockAccountHref?: string | null;
  /** Href of the "Create account" link; invite-only apps leave it unset. */
  readonly signupHref?: string;
  /** Imprint/privacy links under the card: the login screen is often the only
   *  public page of an admin domain, which then must reach its legal pages
   *  itself (German imprint duty). Labels come translated from the caller. */
  readonly legalLinks?: readonly AuthLegalLink[];
  /** Called when the server responds with an MFA challenge instead of a
   *  session. Apps typically swap this screen out for auth-mfa's
   *  MfaVerifyScreen(challengeToken). Without a handler, MFA-enrolled
   *  users see a generic "not supported" error — better than a silent
   *  hang, but apps mounting auth-mfa must wire this. */
  readonly onMfaChallenge?: (challengeToken: string) => void;
  /** Called when the tenant's enforcement policy requires MFA but this
   *  user has no factor enrolled yet. Carries the preauthSetupToken the
   *  login response issued plus the typed email (no session to derive it
   *  from) — apps typically swap this screen out for auth-mfa's
   *  MfaSetupPreauthScreen(preauthSetupToken, accountLabel). Without a
   *  handler, the user sees a "setup required, contact your administrator"
   *  error. */
  readonly onMfaSetupRequired?: (preauthSetupToken: string, accountLabel: string) => void;
};

// Maps login-handler reason codes to i18n keys and optional interpolation parameters.
// Unknown codes fall back to `auth.errors.loginFailed`.
function reasonToKey(failure: LoginFailure): {
  readonly key: string;
  readonly params?: Readonly<Record<string, unknown>>;
} {
  switch (failure.reason) {
    case "invalid_credentials":
      return { key: "auth.errors.invalidCredentials" };
    case "no_membership":
      return { key: "auth.errors.noMembership" };
    case "account_locked":
      if (failure.retryAfterSeconds !== undefined) {
        return {
          key: "auth.errors.accountLockedRetry",
          params: { minutes: Math.ceil(failure.retryAfterSeconds / 60) },
        };
      }
      return { key: "auth.errors.accountLocked" };
    case "email_not_verified":
      return { key: "auth.errors.emailNotVerified" };
    case "rate_limited":
      return { key: "auth.errors.rateLimited" };
    case "invalid_body":
      return { key: "auth.errors.invalidBody" };
    case "mfa_not_supported":
      return { key: "auth.errors.mfaNotSupported" };
    case "mfa_setup_required":
      return { key: "auth.errors.mfaSetupRequired" };
    default:
      return { key: "auth.errors.loginFailed" };
  }
}

function LoginScreenBody({
  title,
  subtitle,
  submitLabel,
  forgotPasswordHref,
  unlockAccountHref,
  signupHref,
  legalLinks,
  onMfaChallenge,
  onMfaSetupRequired,
  loginOptions,
}: LoginScreenProps & { readonly loginOptions: LoginOptions | null }): ReactNode {
  const t = useTranslation();
  const { Form, Field, Input, Button, Banner, Link } = usePrimitives();
  const session = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<LoginFailure | null>(null);
  const [resendStatus, setResendStatus] = useState<ResendStatus>({ kind: "idle" });
  // Hides the resend button once the email input changes; otherwise resend
  // would silently go to the edited, possibly mistyped address.
  const [failedLoginEmail, setFailedLoginEmail] = useState<string | null>(null);
  const basePath = useBasePath();
  const effectiveForgotHref =
    forgotPasswordHref === undefined
      ? loginOptions?.passwordReset === true
        ? prependBasePath(DEFAULT_FORGOT_PASSWORD_PATH, basePath)
        : null
      : forgotPasswordHref;
  const effectiveUnlockHref =
    unlockAccountHref === undefined
      ? loginOptions?.accountUnlock === true
        ? prependBasePath(DEFAULT_AUTH_PATHS.unlockAccount, basePath)
        : null
      : unlockAccountHref;

  const doSubmit = async (): Promise<void> => {
    setSubmitting(true);
    setError(null);
    setResendStatus({ kind: "idle" });
    const res = await session.login({ email, password });
    setSubmitting(false);
    if (res.kind === "success") {
      followNextOrLandingAfterLogin(res.data.landingPath);
      return;
    }
    if (res.kind === "mfa-challenge") {
      if (onMfaChallenge) {
        onMfaChallenge(res.challengeToken);
        return;
      }
      setError({ reason: "mfa_not_supported" satisfies KnownLoginFailureReason });
      setFailedLoginEmail(email);
      return;
    }
    if (res.kind === "mfa-setup-required") {
      if (onMfaSetupRequired) {
        onMfaSetupRequired(res.preauthSetupToken, email);
        return;
      }
      setError({ reason: "mfa_setup_required" satisfies KnownLoginFailureReason });
      setFailedLoginEmail(email);
      return;
    }
    setError(res.error);
    setFailedLoginEmail(email);
  };

  const onSubmit = (e?: FormEvent): void => {
    e?.preventDefault();
    void doSubmit();
  };

  // requestEmailVerification answers 200 even for unknown users, so no
  // anti-enumeration branching is needed; only 429 gets its own hint.
  const onResend = async (): Promise<void> => {
    setResendStatus({ kind: "sending" });
    try {
      const res = await requestEmailVerification(email);
      if (res.ok) {
        setResendStatus({ kind: "success" });
        return;
      }
      setResendStatus({
        kind: res.error.reason === "rate_limited" ? "rateLimited" : "error",
      });
    } catch {
      setResendStatus({ kind: "error" });
    }
  };

  const effectiveTitle = title ?? t("auth.login.title");
  const effectiveSubmit = submitLabel ?? t("auth.login.submit");

  return (
    <AuthCard title={effectiveTitle} subtitle={subtitle}>
      <Form onSubmit={onSubmit}>
        <Field id="login-email" label={t("auth.login.email")} required>
          <Input
            kind="email"
            id="login-email"
            name="login-email"
            value={email}
            onChange={setEmail}
            disabled={submitting}
            required
            autoComplete="email"
          />
        </Field>
        <Field id="login-password" label={t("auth.login.password")} required>
          <Input
            kind="password"
            id="login-password"
            name="login-password"
            value={password}
            onChange={setPassword}
            disabled={submitting}
            required
            autoComplete="current-password"
          />
        </Field>
        {session.signedOutReason === "session-ended" && (
          <Banner variant="info">{t("auth.login.sessionEnded")}</Banner>
        )}
        {resendStatus.kind === "success" ? (
          <Banner variant="info">{t("auth.login.resendSuccess")}</Banner>
        ) : error !== null ? (
          <Banner variant="error">
            <div className="flex flex-col gap-1">
              <span>
                {(() => {
                  const { key, params } = reasonToKey(error);
                  return t(key, params);
                })()}
              </span>
              {error.reason === "email_not_verified" &&
                email.trim().length > 0 &&
                email === failedLoginEmail && (
                  <span className="self-start">
                    <Button
                      variant="link"
                      onClick={() => void onResend()}
                      disabled={resendStatus.kind === "sending"}
                    >
                      {resendStatus.kind === "sending"
                        ? t("auth.login.submitting")
                        : t("auth.login.resendVerification")}
                    </Button>
                  </span>
                )}
              {error.reason === "account_locked" && effectiveUnlockHref !== null && (
                <span className="self-start">
                  <Link href={effectiveUnlockHref} variant="default">
                    {t("auth.login.unlockAccount")}
                  </Link>
                </span>
              )}
              {resendStatus.kind === "rateLimited" && (
                <span className="text-xs">{t("auth.login.resendRateLimited")}</span>
              )}
              {resendStatus.kind === "error" && (
                <span className="text-xs">{t("auth.login.resendError")}</span>
              )}
            </div>
          </Banner>
        ) : null}
        <Button type="submit" loading={submitting} disabled={submitting}>
          {submitting ? t("auth.login.submitting") : effectiveSubmit}
        </Button>
      </Form>
      {effectiveForgotHref !== null && (
        <Link href={effectiveForgotHref} variant="muted" className="self-center">
          {t("auth.login.forgotPassword")}
        </Link>
      )}
      {signupHref !== undefined && (
        <Link href={signupHref} variant="muted" className="self-center">
          {t("auth.signup.title")}
        </Link>
      )}
      {legalLinks !== undefined && legalLinks.length > 0 && (
        <nav
          data-testid="login-legal-links"
          className="flex items-center justify-center gap-3 pt-2 border-t border-border/50"
        >
          {legalLinks.map((link) => (
            <Link key={link.href} href={link.href} variant="muted" className="text-xs">
              {link.label}
            </Link>
          ))}
        </nav>
      )}
    </AuthCard>
  );
}

type LoginOptions = { readonly passwordReset: boolean; readonly accountUnlock: boolean };

function LoginScreenWithQueriedOptions(props: LoginScreenProps): ReactNode {
  const { data } = useQuery<LoginOptions>(
    AuthQueries.loginOptions,
    {},
    { enabled: props.forgotPasswordHref === undefined || props.unlockAccountHref === undefined },
  );
  return <LoginScreenBody {...props} loginOptions={data} />;
}

// Without a mounted dispatcher (standalone mounts, tests) the query is skipped
// and only explicit hrefs render.
export function LoginScreen(props: LoginScreenProps): ReactNode {
  const dispatcher = useOptionalDispatcher();
  return dispatcher === undefined ? (
    <LoginScreenBody {...props} loginOptions={null} />
  ) : (
    <LoginScreenWithQueriedOptions {...props} />
  );
}
