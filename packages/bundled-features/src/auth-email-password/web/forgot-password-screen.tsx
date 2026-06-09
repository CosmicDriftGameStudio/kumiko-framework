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

import { usePrimitives, useTranslation } from "@cosmicdrift/kumiko-renderer";
import { type FormEvent, type ReactNode, useState } from "react";
import { requestPasswordReset } from "./auth-client";
import { AuthCard, authMutedLinkClass } from "./auth-form-primitives";

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
  const { Form, Field, Input, Button, Banner } = usePrimitives();
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // guard:dup-ok — gleiches Submit-Muster wie signup-screen, aber verschiedene API-Endpoints und State
  const doSubmit = async (): Promise<void> => {
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

  const onSubmit = (e?: FormEvent): void => {
    e?.preventDefault();
    void doSubmit();
  };

  const effectiveTitle = title ?? t("auth.forgotPassword.title");

  return (
    <AuthCard title={effectiveTitle} subtitle={subtitle}>
      {done ? (
        <div className="p-6 pt-0 flex flex-col gap-4">
          <Banner variant="info">
            <p className="font-medium text-foreground">{t("auth.forgotPassword.successTitle")}</p>
            <p className="mt-1">{t("auth.forgotPassword.successBody")}</p>
          </Banner>
          <a href={loginHref} className={authMutedLinkClass}>
            {t("auth.forgotPassword.backToLogin")}
          </a>
        </div>
      ) : (
        <div className="p-6 pt-0 flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">{t("auth.forgotPassword.intro")}</p>
          <Form onSubmit={onSubmit}>
            <Field id="forgot-email" label={t("auth.forgotPassword.email")} required>
              <Input
                kind="text"
                id="forgot-email"
                name="forgot-email"
                value={email}
                onChange={setEmail}
                disabled={submitting}
                required
              />
            </Field>
            {error !== null && <Banner variant="error">{error}</Banner>}
            <Button type="submit" loading={submitting} disabled={submitting}>
              {submitting ? t("auth.forgotPassword.submitting") : t("auth.forgotPassword.submit")}
            </Button>
          </Form>
          <a href={loginHref} className={`${authMutedLinkClass} self-center`}>
            {t("auth.forgotPassword.backToLogin")}
          </a>
        </div>
      )}
    </AuthCard>
  );
}
