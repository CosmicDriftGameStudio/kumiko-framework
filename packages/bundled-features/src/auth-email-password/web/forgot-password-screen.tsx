// @runtime client
// ForgotPasswordScreen — Form mit email-input. Submit triggert
// /api/auth/request-password-reset (silent-success, kein account-
// enumeration). UI zeigt unconditional ein "Wenn Account existiert,
// Mail unterwegs"-Confirm — auch wenn der Server intern erkannt hat
// dass die Email nicht existiert.
//
// App ist verantwortlich, den Screen unter einer URL zu mounten (z.B.
// /forgot-password) und ihn zu erreichen — der LoginScreen kann einen
// "Passwort vergessen?"-Link auf die App-Route setzen.

import { useTranslation } from "@kumiko/renderer";
import { type ReactNode, useState } from "react";
import { requestPasswordReset } from "./auth-client";
import {
  AuthBanner,
  AuthCard,
  AuthInput,
  authButtonClass,
  authMutedLinkClass,
} from "./auth-form-primitives";

export type ForgotPasswordScreenProps = {
  readonly title?: string;
  readonly subtitle?: ReactNode;
  /** href für den "Zurück zum Login"-Link in success + form. App-
   *  spezifisch — Default "/login". */
  readonly loginHref?: string;
};

export function ForgotPasswordScreen({
  title,
  subtitle,
  loginHref = "/login",
}: ForgotPasswordScreenProps): ReactNode {
  const t = useTranslation();
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await requestPasswordReset(email);
      if (res.ok) {
        setDone(true);
      } else if (res.error.reason === "rate_limited") {
        const minutes =
          res.error.retryAfterSeconds !== undefined
            ? Math.ceil(res.error.retryAfterSeconds / 60)
            : undefined;
        setError(
          minutes !== undefined
            ? t("auth.errors.accountLockedRetry", { minutes })
            : t("auth.errors.rateLimited"),
        );
      } else {
        setError(t("auth.errors.unknownError"));
      }
    } catch {
      setError(t("auth.errors.unknownError"));
    } finally {
      setSubmitting(false);
    }
  };

  const effectiveTitle = title ?? t("auth.forgotPassword.title");

  return (
    <AuthCard title={effectiveTitle} subtitle={subtitle}>
      {done ? (
        <div className="p-6 pt-0 flex flex-col gap-4">
          <AuthBanner tone="status">
            <p className="font-medium text-foreground">{t("auth.forgotPassword.successTitle")}</p>
            <p className="mt-1">{t("auth.forgotPassword.successBody")}</p>
          </AuthBanner>
          <a href={loginHref} className={authMutedLinkClass}>
            {t("auth.forgotPassword.backToLogin")}
          </a>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="flex flex-col gap-4 p-6 pt-0">
          <p className="text-sm text-muted-foreground">{t("auth.forgotPassword.intro")}</p>
          <AuthInput
            id="forgot-email"
            label={t("auth.forgotPassword.email")}
            type="email"
            autoComplete="email"
            required
            disabled={submitting}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          {error !== null && <AuthBanner tone="error">{error}</AuthBanner>}
          <button type="submit" disabled={submitting} className={authButtonClass}>
            {submitting ? t("auth.forgotPassword.submitting") : t("auth.forgotPassword.submit")}
          </button>
          <a href={loginHref} className={`${authMutedLinkClass} self-center`}>
            {t("auth.forgotPassword.backToLogin")}
          </a>
        </form>
      )}
    </AuthCard>
  );
}
