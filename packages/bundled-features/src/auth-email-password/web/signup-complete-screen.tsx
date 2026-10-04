// @runtime client
// SignupCompleteScreen — Magic-Link-Self-Signup, Step 2.
//
// Reads `?token=...` from the URL, shows a form with password + confirm.
// Submit posts to /api/auth/signup-confirm — on success the server sets
// JWT + cookies (auto-login!) and returns the tenantKey.
//
// Token source is read-once via useUrlToken: reads `?token=...` on mount
// and scrubs the param from the URL afterwards (#774). Apps that inject a
// server-side token pass `token` as a prop instead.
//
// On success: shows a confirmation (account active, signed in) with a
// button to the continue target, instead of navigating away immediately —
// the server already logged the user in via cookies, but a silent redirect
// leaves no signal that activation worked. Server-side auth.postAuthLanding
// (landingPath) wins over loggedInHref; loggedInHref is the deprecated
// per-app fallback. Default pattern is "/" — apps with multi-tenant routing
// pass `(data) => "/" + data.tenantKey + "/"`.

import { usePrimitives, useTranslation } from "@cosmicdrift/kumiko-renderer";
import { type FormEvent, type ReactNode, useState } from "react";
import { confirmSignup, type SignupConfirmSuccess } from "./auth-client.js";
import { passwordPairIssue, resolvePostAuthHref } from "./auth-form-logic.js";
import { AuthCard, useUrlToken } from "./auth-form-primitives.js";

export type SignupCompleteScreenProps = {
  readonly title?: string;
  /** Override for the URL token — server-rendered apps can pass it. Default: `?token=...`. */
  readonly token?: string;
  /** Where to send the user after activation. Function-form receives the tenantKey, the
   *  roles granted by this flow in that tenant, and the claimed `handover` entity when
   *  signup claimed a try-first grant. Default "/".
   *  @deprecated Configure auth.postAuthLanding on the server; its landingPath wins.
   *  Kept as fallback. */
  readonly loggedInHref?:
    | string
    | ((args: {
        tenantKey: string;
        roles: readonly string[];
        handover?: SignupConfirmSuccess["handover"];
      }) => string);
  /** Href for the "already have an account?" link when the token is missing. Default "/login". */
  readonly loginHref?: string;
};

export function SignupCompleteScreen({
  title,
  token: tokenProp,
  loggedInHref = "/",
  loginHref = "/login",
}: SignupCompleteScreenProps): ReactNode {
  const t = useTranslation();
  const { Form, Field, Input, Button, Banner, Link } = usePrimitives();
  const token = useUrlToken(tokenProp);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [continueHref, setContinueHref] = useState<string | null>(null);
  const [mfaPending, setMfaPending] = useState(false);

  const doSubmit = async (): Promise<void> => {
    setError(null);
    const issue = passwordPairIssue(password, confirmPassword);
    if (issue === "too_short") {
      setError(t("auth.signupComplete.tooShort"));
      return;
    }
    if (issue === "mismatch") {
      setError(t("auth.signupComplete.mismatch"));
      return;
    }
    setSubmitting(true);
    const res = await confirmSignup(token, password);
    setSubmitting(false);
    if (res.ok) {
      if (res.data.kind === "mfa-pending") {
        setMfaPending(true);
        setContinueHref(loginHref);
        return;
      }
      // Cookies are already set (auto-login). Show a confirmation with an
      // explicit continue button instead of navigating away silently —
      // the user otherwise gets no signal that activation worked.
      setContinueHref(
        resolvePostAuthHref(res.data.landingPath, loggedInHref, {
          tenantKey: res.data.tenantKey,
          roles: res.data.user.roles,
          ...(res.data.handover !== undefined && { handover: res.data.handover }),
        }),
      );
      return;
    }
    if (res.error.reason === "invalid_signup_token") {
      setError(t("auth.errors.invalidSignupToken"));
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

  const effectiveTitle =
    title ??
    (continueHref !== null
      ? t("auth.signupComplete.activatedTitle")
      : t("auth.signupComplete.title"));

  // Kein Token in der URL → klare Message statt Form ohne Token
  // (würde nur invalidSignupToken zeigen, verwirrend).
  if (token === "") {
    return (
      <AuthCard title={effectiveTitle}>
        <p className="text-sm text-muted-foreground">{t("auth.signupComplete.missingToken")}</p>
        <Link href={loginHref} variant="muted">
          {t("auth.signup.haveAccount")}
        </Link>
      </AuthCard>
    );
  }

  if (continueHref !== null) {
    return (
      <AuthCard title={effectiveTitle}>
        <p className="text-sm text-muted-foreground" role="status">
          {t(
            mfaPending
              ? "auth.signupComplete.activatedMfaPending"
              : "auth.signupComplete.activated",
          )}
        </p>
        <Link href={continueHref} variant="button">
          {t("auth.signupComplete.continue")}
        </Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard title={effectiveTitle}>
      <p className="text-sm text-muted-foreground">{t("auth.signupComplete.intro")}</p>
      <Form onSubmit={onSubmit}>
        <Field id="signup-password" label={t("auth.signupComplete.password")} required>
          <Input
            kind="password"
            id="signup-password"
            name="signup-password"
            value={password}
            onChange={setPassword}
            disabled={submitting}
            required
            autoComplete="new-password"
          />
        </Field>
        <Field
          id="signup-confirm-password"
          label={t("auth.signupComplete.confirmPassword")}
          required
        >
          <Input
            kind="password"
            id="signup-confirm-password"
            name="signup-confirm-password"
            value={confirmPassword}
            onChange={setConfirmPassword}
            disabled={submitting}
            required
            autoComplete="new-password"
          />
        </Field>
        {error !== null && <Banner variant="error">{error}</Banner>}
        <Button type="submit" loading={submitting} disabled={submitting}>
          {submitting ? t("auth.signupComplete.submitting") : t("auth.signupComplete.submit")}
        </Button>
      </Form>
    </AuthCard>
  );
}
