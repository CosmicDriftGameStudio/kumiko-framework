// @runtime client
// Default-LoginScreen. Reine E-Mail-+-Passwort-Form, zentriert, Card-
// Layout. Texte kommen aus `useTranslation()` — die Default-Bundles
// (de+en) liefert das Feature selber mit (translations.ts); Apps die
// was anderes wollen, setzen entweder einen eigenen LocaleResolver auf
// App-Level oder reichen Key-Overrides an `emailPasswordClient()`.
//
// Die Reason-Codes aus dem Login-Handler werden 1:1 auf i18n-Keys
// gemappt (reasonToI18nKey) — neue Reason-Codes brauchen nur eine
// neue Zeile im Bundle + hier im Mapping.

import { usePrimitives, useTranslation } from "@cosmicdrift/kumiko-renderer";
import { type FormEvent, type ReactNode, useState } from "react";
import { type LoginFailure, requestEmailVerification } from "./auth-client";
import { AuthCard } from "./auth-form-primitives";
import { useSession } from "./session";

// Resend-Status für den "Bestätigungs-Mail erneut senden"-Flow, der bei
// reason=email_not_verified unter dem Fehler-Banner angeboten wird.
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
  /** Overridet den `auth.login.title`-i18n-Key. Nur setzen wenn der
   *  Titel stark app-branded ist und keine Translation braucht. */
  readonly title?: string;
  readonly subtitle?: ReactNode;
  readonly submitLabel?: string;
  /** Optional href zum ForgotPasswordScreen. Wenn gesetzt rendert die
   *  LoginScreen unter dem Submit-Button einen "Passwort vergessen?"-
   *  Link. Apps die den Reset-Flow NICHT anbieten (z.B. nur Magic-Link),
   *  setzen das einfach nicht — Login bleibt minimalistisch. */
  readonly forgotPasswordHref?: string;
  /** Optional href to RequestAccountUnlockScreen (#1266). When set, an
   *  account_locked login error renders an "Unlock account?" link inline —
   *  the account-lockout escape hatch, since forgotPasswordHref does NOT
   *  help here: the lockout gate blocks login before password verify even
   *  runs, so it also blocks the post-reset login. Apps without
   *  accountUnlock configured just leave this unset. */
  readonly unlockAccountHref?: string;
  /** Optional href zum SignupScreen. Wenn gesetzt rendert die LoginScreen
   *  einen "Account erstellen"-Link. Apps die kein Self-Signup wollen
   *  (closed-invite-only) setzen das einfach nicht. */
  readonly signupHref?: string;
  /** Impressum/Datenschutz unterhalb der Card — der Login-Screen ist
   *  oft die einzige öffentliche Seite einer Admin-Domain und braucht
   *  dann selbst erreichbare Legal-Links (DE: Impressumspflicht).
   *  Labels kommen vom Caller (typisch schon übersetzt bzw. Eigennamen
   *  wie "Impressum"). */
  readonly legalLinks?: readonly AuthLegalLink[];
  /** Called when the server responds with an MFA challenge instead of a
   *  session. Apps typically swap this screen out for auth-mfa's
   *  MfaVerifyScreen(challengeToken). Without a handler, MFA-enrolled
   *  users see a generic "not supported" error — better than a silent
   *  hang, but apps mounting auth-mfa must wire this. */
  readonly onMfaChallenge?: (challengeToken: string) => void;
  /** Called when the tenant's enforcement policy requires MFA but this
   *  user has no factor enrolled yet. Apps typically route to an
   *  enrollment flow. Without a handler, the user sees a "setup required,
   *  contact your administrator" error. */
  readonly onMfaSetupRequired?: () => void;
};

// Map vom Reason-Code des Login-Handlers auf einen i18n-Key plus
// optional extrahierte Interpolations-Parameter. Ungekannte Codes
// fallen auf `auth.errors.loginFailed` zurück.
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

export function LoginScreen({
  title,
  subtitle,
  submitLabel,
  forgotPasswordHref,
  unlockAccountHref,
  signupHref,
  legalLinks,
  onMfaChallenge,
  onMfaSetupRequired,
}: LoginScreenProps): ReactNode {
  const t = useTranslation();
  const { Form, Field, Input, Button, Banner, Link } = usePrimitives();
  const session = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<LoginFailure | null>(null);
  const [resendStatus, setResendStatus] = useState<ResendStatus>({ kind: "idle" });
  // Tracked, damit der Resend-Button verschwindet sobald der User die
  // Email-Eingabe ändert — sonst würde Resend silent an die geänderte
  // (potentiell typoed) Adresse gehen ohne User-Feedback.
  const [failedLoginEmail, setFailedLoginEmail] = useState<string | null>(null);

  const doSubmit = async (): Promise<void> => {
    setSubmitting(true);
    setError(null);
    setResendStatus({ kind: "idle" });
    const res = await session.login({ email, password });
    setSubmitting(false);
    if (res.kind === "success") return;
    if (res.kind === "mfa-challenge") {
      if (onMfaChallenge) {
        onMfaChallenge(res.challengeToken);
        return;
      }
      setError({ reason: "mfa_not_supported" });
      setFailedLoginEmail(email);
      return;
    }
    if (res.kind === "mfa-setup-required") {
      if (onMfaSetupRequired) {
        onMfaSetupRequired();
        return;
      }
      setError({ reason: "mfa_setup_required" });
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

  // Resend-Bestätigungsmail bei reason=email_not_verified. requestEmail-
  // Verification ist silent-success (200 auch wenn kein User existiert),
  // sodass kein anti-enumeration-Branching nötig ist; 429 → rate-limit-
  // Hint inline, sonstige Fehler → generischer Inline-Hint.
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
      <div className="p-6 pt-0 flex flex-col gap-4">
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
                {error.reason === "account_locked" && unlockAccountHref !== undefined && (
                  <span className="self-start">
                    <Link href={unlockAccountHref} variant="default">
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
        {forgotPasswordHref !== undefined && (
          <Link href={forgotPasswordHref} variant="muted" className="self-center">
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
      </div>
    </AuthCard>
  );
}
