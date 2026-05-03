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

import { usePrimitives, useTranslation } from "@kumiko/renderer";
import { type FormEvent, type ReactNode, useState } from "react";
import type { LoginFailure } from "./auth-client";
import { AuthCard, authMutedLinkClass } from "./auth-form-primitives";
import { useSession } from "./session";

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
  /** Optional href zum SignupScreen. Wenn gesetzt rendert die LoginScreen
   *  einen "Account erstellen"-Link. Apps die kein Self-Signup wollen
   *  (closed-invite-only) setzen das einfach nicht. */
  readonly signupHref?: string;
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
    default:
      return { key: "auth.errors.loginFailed" };
  }
}

export function LoginScreen({
  title,
  subtitle,
  submitLabel,
  forgotPasswordHref,
  signupHref,
}: LoginScreenProps): ReactNode {
  const t = useTranslation();
  const { Form, Field, Input, Button, Banner } = usePrimitives();
  const session = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<LoginFailure | null>(null);

  const doSubmit = async (): Promise<void> => {
    setSubmitting(true);
    setError(null);
    const res = await session.login({ email, password });
    setSubmitting(false);
    if (!res.ok) setError(res.error);
  };

  const onSubmit = (e?: FormEvent): void => {
    e?.preventDefault();
    void doSubmit();
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
          {error !== null && (
            <Banner variant="error">
              {(() => {
                const { key, params } = reasonToKey(error);
                return t(key, params);
              })()}
            </Banner>
          )}
          <Button type="submit" loading={submitting} disabled={submitting}>
            {submitting ? t("auth.login.submitting") : effectiveSubmit}
          </Button>
        </Form>
        {forgotPasswordHref !== undefined && (
          <a href={forgotPasswordHref} className={`${authMutedLinkClass} self-center`}>
            {t("auth.login.forgotPassword")}
          </a>
        )}
        {signupHref !== undefined && (
          <a href={signupHref} className={`${authMutedLinkClass} self-center`}>
            {t("auth.signup.title")}
          </a>
        )}
      </div>
    </AuthCard>
  );
}
