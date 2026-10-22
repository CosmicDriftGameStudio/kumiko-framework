// SignupScreen — Magic-Link self-signup, Step 1.
//
// Form with an email input. Submission triggers /api/auth/signup-request
// (silent success, no account enumeration). The UI always shows a
// "email on its way" confirmation with a Resend button, even if the email
// is already registered (the server then sends the same email with the
// existing token from Redis, making the request idempotent).
//
// The app is responsible for mounting the screen at a URL (e.g.
// /signup) and making it anonymously reachable (AuthPathGate before
// AuthGate). An apex marketing site can route its "Start for free" link to
// the /signup path.

import { usePrimitives, useTranslation } from "@cosmicdrift/kumiko-renderer";
import { type FormEvent, type ReactNode, useState } from "react";
import { requestSignup } from "./auth-client.ts";
import { retryAfterMinutes } from "./auth-form-logic.ts";
import { AuthCard } from "./auth-form-primitives.tsx";
import { readReturnToFromWindow } from "./auth-redirect.ts";
import { isSafeReturnPath } from "./return-path.ts";

export type SignupScreenProps = {
  readonly title?: string;
  readonly subtitle?: ReactNode;
  /** href for the "Already have an account?" link. App-specific; defaults to
   *  "/login". */
  readonly loginHref?: string;
  /** Page the activation mail should lead to after signup; defaults to the `returnTo` query
   *  parameter of this page. Unsafe values are dropped. */
  readonly returnTo?: string;
};

function resolveReturnTo(prop: string | undefined): string | undefined {
  return (isSafeReturnPath(prop) ? prop : readReturnToFromWindow()) ?? undefined;
}

export function SignupScreen({
  title,
  subtitle,
  loginHref = "/login",
  returnTo,
}: SignupScreenProps): ReactNode {
  const t = useTranslation();
  const { Form, Field, Input, Button, Banner, Link } = usePrimitives();
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const doSubmit = async (): Promise<void> => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await requestSignup(email, undefined, resolveReturnTo(returnTo));
      if (res.ok) {
        setDone(true);
      } else if (res.error.reason === "rate_limited") {
        const minutes = retryAfterMinutes(res.error.retryAfterSeconds);
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

  const onResend = async (): Promise<void> => {
    // Resend uses the same endpoint: the server returns the existing
    // token from Redis and sends a second email with the SAME
    // activation link, so the old email remains valid.
    setSubmitting(true);
    setError(null);
    try {
      await requestSignup(email, undefined, resolveReturnTo(returnTo));
    } finally {
      setSubmitting(false);
    }
  };

  const effectiveTitle = title ?? t("auth.signup.title");

  return (
    <AuthCard title={effectiveTitle} subtitle={subtitle}>
      {done ? (
        <>
          <Banner variant="info">
            <p className="font-medium text-foreground">{t("auth.signup.successTitle")}</p>
            <p className="mt-1">{t("auth.signup.successBody")}</p>
          </Banner>
          <Button variant="secondary" onClick={onResend} disabled={submitting}>
            {t("auth.signup.resend")}
          </Button>
          <Link href={loginHref} variant="muted">
            {t("auth.signup.haveAccount")}
          </Link>
        </>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">{t("auth.signup.intro")}</p>
          <Form onSubmit={onSubmit}>
            <Field id="signup-email" label={t("auth.signup.email")} required>
              <Input
                kind="email"
                id="signup-email"
                name="signup-email"
                value={email}
                onChange={setEmail}
                disabled={submitting}
                required
                autoComplete="email"
              />
            </Field>
            {error !== null && <Banner variant="error">{error}</Banner>}
            <Button type="submit" loading={submitting} disabled={submitting}>
              {submitting ? t("auth.signup.submitting") : t("auth.signup.submit")}
            </Button>
          </Form>
          <Link href={loginHref} variant="muted" className="self-center">
            {t("auth.signup.haveAccount")}
          </Link>
        </>
      )}
    </AuthCard>
  );
}
