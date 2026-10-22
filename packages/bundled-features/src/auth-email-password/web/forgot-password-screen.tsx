// ForgotPasswordScreen — form with an email input. Submission triggers
// /api/auth/request-password-reset (silent success, no account enumeration).
// The UI always shows a "If an account exists, the email is on its way"
// confirmation, even when the server determines internally that the email
// does not exist.
//
// The app is responsible for mounting and exposing the screen at a URL
// (for example, /forgot-password); the LoginScreen can link to that app
// route with a "Forgot password?" link.

import { usePrimitives, useTranslation } from "@cosmicdrift/kumiko-renderer";
import { type FormEvent, type ReactNode, useState } from "react";
import { requestPasswordReset } from "./auth-client.ts";
import { AuthCard } from "./auth-form-primitives.tsx";
import { readReturnToFromWindow } from "./auth-redirect.ts";
import { isSafeReturnPath } from "./return-path.ts";

export type ForgotPasswordScreenProps = {
  readonly title?: string;
  readonly subtitle?: ReactNode;
  /** href for the "Back to login" link in the success and form states. App-
   * specific — defaults to "/login". */
  readonly loginHref?: string;
  /** Page the reset mail should lead back to after the new password is set; defaults to the
   *  `returnTo` query parameter of this page. Unsafe values are dropped. */
  readonly returnTo?: string;
};

function resolveReturnTo(prop: string | undefined): string | undefined {
  return (isSafeReturnPath(prop) ? prop : readReturnToFromWindow()) ?? undefined;
}

export function ForgotPasswordScreen({
  title,
  subtitle,
  loginHref = "/login",
  returnTo,
}: ForgotPasswordScreenProps): ReactNode {
  const t = useTranslation();
  const { Form, Field, Input, Button, Banner, Link } = usePrimitives();
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // guard:dup-ok — same submission pattern as signup-screen, but with different API endpoints and state
  const doSubmit = async (): Promise<void> => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await requestPasswordReset(email, resolveReturnTo(returnTo));
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
        <>
          <Banner variant="info">
            <p className="font-medium text-foreground">{t("auth.forgotPassword.successTitle")}</p>
            <p className="mt-1">{t("auth.forgotPassword.successBody")}</p>
          </Banner>
          <Link href={loginHref} variant="muted">
            {t("auth.forgotPassword.backToLogin")}
          </Link>
        </>
      ) : (
        <>
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
          <Link href={loginHref} variant="muted" className="self-center">
            {t("auth.forgotPassword.backToLogin")}
          </Link>
        </>
      )}
    </AuthCard>
  );
}
