// ResetPasswordScreen reads `?token=...` from the URL and shows fields for
// a new and confirmed password. Submission calls /api/auth/reset-password
// with the token. The server collapses all token-verification failures into
// one code (anti-enumeration), so the UI shows the unified "link invalid or
// expired" message.
//
// The token is read once via useUrlToken(): `?token=...` is read on mount and
// then scrubbed from the URL. Apps that need different behavior can pass a
// server-injected token through the `token` prop; the URL is then left intact.

import { usePrimitives, useTranslation } from "@cosmicdrift/kumiko-renderer";
import { type FormEvent, type ReactNode, useState } from "react";
import { resetPassword } from "./auth-client.ts";
import { passwordPairIssue } from "./auth-form-logic.ts";
import { AuthCard, useUrlToken } from "./auth-form-primitives.tsx";
import { buildLoginRedirectUrl, readReturnToFromWindow } from "./auth-redirect.ts";

export type ResetPasswordScreenProps = {
  readonly title?: string;
  /** Override for the token from the URL. Apps that pass a token during
   * server-side rendering need this. Default: parsed from `?token=...` in
   * the URL. */
  readonly token?: string;
  /** href for the "Zum Login" link after success. Default "/login". */
  readonly loginHref?: string;
};

export function ResetPasswordScreen({
  title,
  token: tokenProp,
  loginHref = "/login",
}: ResetPasswordScreenProps): ReactNode {
  const t = useTranslation();
  const { Form, Field, Input, Button, Banner, Link } = usePrimitives();
  const token = useUrlToken(tokenProp);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [afterResetHref, setAfterResetHref] = useState(loginHref);

  const doSubmit = async (): Promise<void> => {
    setError(null);
    const issue = passwordPairIssue(newPassword, confirmPassword);
    if (issue === "too_short") {
      setError(t("auth.resetPassword.tooShort"));
      return;
    }
    if (issue === "mismatch") {
      setError(t("auth.resetPassword.mismatch"));
      return;
    }
    setSubmitting(true);
    const res = await resetPassword(token, newPassword);
    setSubmitting(false);
    if (res.ok) {
      const returnTo = readReturnToFromWindow();
      if (returnTo !== null) {
        setAfterResetHref(buildLoginRedirectUrl(loginHref, returnTo, window.location.origin));
      }
      setDone(true);
      return;
    }
    if (res.error.reason === "invalid_reset_token") {
      setError(t("auth.errors.invalidResetToken"));
      return;
    }
    if (res.error.reason === "rate_limited") {
      setError(t("auth.errors.rateLimited"));
      return;
    }
    setError(t("auth.errors.unknownError"));
  };

  const onSubmit = (e?: FormEvent): void => {
    e?.preventDefault();
    void doSubmit();
  };

  const effectiveTitle = title ?? t("auth.resetPassword.title");

  // No token in the URL: the user should click the link from their email again
  // or request a new reset. Submitting without a token would only show the
  // invalidResetToken error, which is confusing, so show a clear message
  // immediately instead.
  if (token === "") {
    return (
      <AuthCard title={effectiveTitle}>
        <p className="text-sm text-muted-foreground">{t("auth.resetPassword.missingToken")}</p>
        <Link href={loginHref} variant="muted">
          {t("auth.resetPassword.goToLogin")}
        </Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard title={effectiveTitle}>
      {done ? (
        <>
          <Banner variant="info">
            <p className="font-medium text-foreground">{t("auth.resetPassword.successTitle")}</p>
            <p className="mt-1">{t("auth.resetPassword.successBody")}</p>
          </Banner>
          <Link href={afterResetHref} variant="button">
            {t("auth.resetPassword.goToLogin")}
          </Link>
        </>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">{t("auth.resetPassword.intro")}</p>
          <Form onSubmit={onSubmit}>
            <Field id="reset-new-password" label={t("auth.resetPassword.newPassword")} required>
              <Input
                kind="password"
                id="reset-new-password"
                name="reset-new-password"
                value={newPassword}
                onChange={setNewPassword}
                disabled={submitting}
                required
                autoComplete="new-password"
              />
            </Field>
            <Field
              id="reset-confirm-password"
              label={t("auth.resetPassword.confirmPassword")}
              required
            >
              <Input
                kind="password"
                id="reset-confirm-password"
                name="reset-confirm-password"
                value={confirmPassword}
                onChange={setConfirmPassword}
                disabled={submitting}
                required
                autoComplete="new-password"
              />
            </Field>
            {error !== null && <Banner variant="error">{error}</Banner>}
            <Button type="submit" loading={submitting} disabled={submitting}>
              {submitting ? t("auth.resetPassword.submitting") : t("auth.resetPassword.submit")}
            </Button>
          </Form>
        </>
      )}
    </AuthCard>
  );
}
