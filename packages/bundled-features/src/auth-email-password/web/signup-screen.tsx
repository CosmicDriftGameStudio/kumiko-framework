// SignupScreen — Magic-Link self-signup, Step 1.
//
// Form with an email input. Submission triggers /api/auth/signup-request
// (silent success, no account enumeration). The UI always shows a
// "email on its way" confirmation with a Resend button, even if the email
// is already registered (the server then sends the same email with the
// existing token from Redis, making the request idempotent).
//
// DefaultAuthPagesGate serves this screen at /signup; apps without that gate
// mount it themselves and make it anonymously reachable (AuthPathGate before
// AuthGate). An apex marketing site can route its "Start for free" link to
// the /signup path.

import {
  useOptionalDispatcher,
  usePrimitives,
  useQuery,
  useTranslation,
} from "@cosmicdrift/kumiko-renderer";
import { type FormEvent, type ReactNode, useState } from "react";
import { requestSignup } from "./auth-client.ts";
import { retryAfterMinutes } from "./auth-form-logic.ts";
import { AuthCard } from "./auth-form-primitives.tsx";
import { resolveReturnTo } from "./auth-redirect.ts";
import { AuthQueries } from "./constants.ts";
import { hasLikelyAuthSession } from "./session.tsx";

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

function SignupScreenBody({
  title,
  subtitle,
  loginHref = "/login",
  returnTo,
  registrationOpen,
}: SignupScreenProps & { readonly registrationOpen: boolean | "unknown" }): ReactNode {
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

  if (registrationOpen === "unknown") {
    return (
      <AuthCard title={effectiveTitle} subtitle={subtitle}>
        {null}
      </AuthCard>
    );
  }

  if (!registrationOpen) {
    return (
      <AuthCard title={effectiveTitle} subtitle={subtitle}>
        <Banner variant="info">{t("auth.signup.closed")}</Banner>
        <Link href={loginHref} variant="muted">
          {t("auth.signup.haveAccount")}
        </Link>
      </AuthCard>
    );
  }

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

type RegistrationStatus = { readonly enabled: boolean };

// A failed status query reads as open: signup-request itself stays the authority.
function SignupScreenWithQueriedStatus(props: SignupScreenProps): ReactNode {
  const { data, loading } = useQuery<RegistrationStatus>(AuthQueries.signupRegistrationStatus, {});
  const registrationOpen = loading && data === null ? "unknown" : data?.enabled !== false;
  return <SignupScreenBody {...props} registrationOpen={registrationOpen} />;
}

function DefaultSignupRouteWithStatus({
  loginHref,
  children,
}: {
  readonly loginHref: string;
  readonly children: ReactNode;
}): ReactNode {
  const { data, loading, error } = useQuery<RegistrationStatus>(
    AuthQueries.signupRegistrationStatus,
    {},
  );
  // The query exists only when the server mounts signup; without it /signup does not belong to the FW.
  if (error !== null) return <>{children}</>;
  if (loading && data === null) return null;
  return <SignupScreenBody loginHref={loginHref} registrationOpen={data?.enabled !== false} />;
}

// /signup route of the default auth pages: signed-in visitors land in the app,
// and an app whose server has no signup keeps its own /signup.
export function DefaultSignupRoute({
  loginHref,
  children,
}: {
  readonly loginHref: string;
  readonly children: ReactNode;
}): ReactNode {
  const dispatcher = useOptionalDispatcher();
  if (hasLikelyAuthSession()) return <>{children}</>;
  if (dispatcher === undefined) return <SignupScreenBody loginHref={loginHref} registrationOpen />;
  return (
    <DefaultSignupRouteWithStatus loginHref={loginHref}>{children}</DefaultSignupRouteWithStatus>
  );
}

// Without a mounted dispatcher (standalone mounts, tests) the status is not asked and the form shows.
export function SignupScreen(props: SignupScreenProps): ReactNode {
  const dispatcher = useOptionalDispatcher();
  return dispatcher === undefined ? (
    <SignupScreenBody {...props} registrationOpen />
  ) : (
    <SignupScreenWithQueriedStatus {...props} />
  );
}
