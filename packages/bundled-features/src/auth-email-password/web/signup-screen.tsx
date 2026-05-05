// @runtime client
// SignupScreen — Magic-Link-Self-Signup, Step 1.
//
// Form mit Email-Input. Submit triggert /api/auth/signup-request
// (silent-success, kein account-enumeration). UI zeigt unconditional
// ein "Mail unterwegs"-Confirm mit Resend-Button — auch wenn die Email
// schon registriert ist (Server schickt dann dieselbe Mail mit dem
// existing Token aus Redis = idempotent).
//
// App ist verantwortlich, den Screen unter einer URL zu mounten (z.B.
// /signup) und ihn anonymous reachable zu machen (AuthPathGate VOR
// AuthGate). Apex-Marketing kann via Link "Kostenlos starten" auf den
// /signup-Pfad routen.

import { usePrimitives, useTranslation } from "@cosmicdrift/kumiko-renderer";
import { type FormEvent, type ReactNode, useState } from "react";
import { requestSignup } from "./auth-client";
import { AuthCard, authMutedLinkClass } from "./auth-form-primitives";

export type SignupScreenProps = {
  readonly title?: string;
  readonly subtitle?: ReactNode;
  /** href für den "Bereits einen Account?"-Link. App-spezifisch — Default
   *  "/login". */
  readonly loginHref?: string;
};

export function SignupScreen({
  title,
  subtitle,
  loginHref = "/login",
}: SignupScreenProps): ReactNode {
  const t = useTranslation();
  const { Form, Field, Input, Button, Banner } = usePrimitives();
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const doSubmit = async (): Promise<void> => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await requestSignup(email);
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

  const onResend = async (): Promise<void> => {
    // Resend nutzt den gleichen Endpunkt — Server returnt den existing
    // Token aus Redis und schickt eine zweite Mail mit dem GLEICHEN
    // Activation-Link (alte Mail bleibt also gültig).
    setSubmitting(true);
    setError(null);
    try {
      await requestSignup(email);
    } finally {
      setSubmitting(false);
    }
  };

  const effectiveTitle = title ?? t("auth.signup.title");

  return (
    <AuthCard title={effectiveTitle} subtitle={subtitle}>
      {done ? (
        <div className="p-6 pt-0 flex flex-col gap-4">
          <Banner variant="info">
            <p className="font-medium text-foreground">{t("auth.signup.successTitle")}</p>
            <p className="mt-1">{t("auth.signup.successBody")}</p>
          </Banner>
          <Button variant="secondary" onClick={onResend} disabled={submitting}>
            {t("auth.signup.resend")}
          </Button>
          <a href={loginHref} className={authMutedLinkClass}>
            {t("auth.signup.haveAccount")}
          </a>
        </div>
      ) : (
        <div className="p-6 pt-0 flex flex-col gap-4">
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
          <a href={loginHref} className={`${authMutedLinkClass} self-center`}>
            {t("auth.signup.haveAccount")}
          </a>
        </div>
      )}
    </AuthCard>
  );
}
