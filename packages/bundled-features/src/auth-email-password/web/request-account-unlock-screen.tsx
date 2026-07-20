// @runtime client
// RequestAccountUnlockScreen — form with an email input. Submit triggers
// /api/auth/request-account-unlock (silent-success, no account
// enumeration). UI unconditionally shows an "if your account is locked,
// a mail is on its way" confirmation — even when the server internally
// knows the email doesn't exist or isn't locked. Mirrors
// ForgotPasswordScreen 1:1.
//
// The app is responsible for mounting this screen under a URL (e.g.
// /unlock-account) and for reaching it — LoginScreen can render a link
// to the app route on accountLocked errors.

import { usePrimitives, useTranslation } from "@cosmicdrift/kumiko-renderer";
import { type FormEvent, type ReactNode, useState } from "react";
import { requestAccountUnlock } from "./auth-client";
import { AuthCard } from "./auth-form-primitives";

export type RequestAccountUnlockScreenProps = {
  readonly title?: string;
  readonly subtitle?: ReactNode;
  /** href for the "back to sign in" link in success + form state. App-
   *  specific — default "/login". */
  readonly loginHref?: string;
};

export function RequestAccountUnlockScreen({
  title,
  subtitle,
  loginHref = "/login",
}: RequestAccountUnlockScreenProps): ReactNode {
  const t = useTranslation();
  const { Form, Field, Input, Button, Banner, Link } = usePrimitives();
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // guard:dup-ok — same submit pattern as forgot-password-screen, but different API endpoint and state
  const doSubmit = async (): Promise<void> => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await requestAccountUnlock(email);
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

  const effectiveTitle = title ?? t("auth.requestUnlock.title");

  return (
    <AuthCard title={effectiveTitle} subtitle={subtitle}>
      {done ? (
        <div className="p-6 pt-0 flex flex-col gap-4">
          <Banner variant="info">
            <p className="font-medium text-foreground">{t("auth.requestUnlock.successTitle")}</p>
            <p className="mt-1">{t("auth.requestUnlock.successBody")}</p>
          </Banner>
          <Link href={loginHref} variant="muted">
            {t("auth.requestUnlock.backToLogin")}
          </Link>
        </div>
      ) : (
        <div className="p-6 pt-0 flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">{t("auth.requestUnlock.intro")}</p>
          <Form onSubmit={onSubmit}>
            <Field id="unlock-email" label={t("auth.requestUnlock.email")} required>
              <Input
                kind="text"
                id="unlock-email"
                name="unlock-email"
                value={email}
                onChange={setEmail}
                disabled={submitting}
                required
              />
            </Field>
            {error !== null && <Banner variant="error">{error}</Banner>}
            <Button type="submit" loading={submitting} disabled={submitting}>
              {submitting ? t("auth.requestUnlock.submitting") : t("auth.requestUnlock.submit")}
            </Button>
          </Form>
          <Link href={loginHref} variant="muted" className="self-center">
            {t("auth.requestUnlock.backToLogin")}
          </Link>
        </div>
      )}
    </AuthCard>
  );
}
