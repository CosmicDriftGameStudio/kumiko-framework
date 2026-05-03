// @runtime client
// SignupCompleteScreen — Magic-Link-Self-Signup, Step 2.
//
// Liest `?token=...` aus der URL, zeigt Form mit Password + Confirm.
// Submit triggert /api/auth/signup-confirm — bei Erfolg setzt der
// Server JWT + Cookies (Auto-Login!) und liefert tenantKey für den
// Post-Signup-Redirect.
//
// Token-Quelle ist read-once: parseUrlToken im useState-Initializer.
// Apps die einen anderen URL-Param nutzen, reichen `token` als Prop
// durch.
//
// Nach success: redirect via window.location.assign zu loggedInHref.
// Default-Pattern ist "/<tenantKey>/" — die App reicht ein Template
// rein. Default-Template "/" wäre auch valide (App hat dann eigene
// Routing-Logik die den eingeloggten User zur richtigen Page schickt).

import { useTranslation } from "@kumiko/renderer";
import { type ReactNode, useState } from "react";
import { confirmSignup } from "./auth-client";
import {
  AuthBanner,
  AuthCard,
  AuthInput,
  authButtonClass,
  authMutedLinkClass,
  parseUrlToken,
} from "./auth-form-primitives";

export type SignupCompleteScreenProps = {
  readonly title?: string;
  /** Override für den Token aus der URL — Apps die per server-side-
   *  Render einen Token reinreichen, brauchen das. Default: parsed aus
   *  `?token=...` in der URL. */
  readonly token?: string;
  /** Where to send the user after successful activation. Default "/" —
   *  Apps mit Multi-Tenant-Routing ersetzen das durch
   *  `(data) => "/" + data.tenantKey + "/"`. Function-form, weil nur
   *  nach success bekannt welcher tenantKey zugeteilt wurde. */
  readonly loggedInHref?: string | ((args: { tenantKey: string }) => string);
  /** href für "Schon einen Account?"-Link bei missing-token-Fall.
   *  Default "/login". */
  readonly loginHref?: string;
};

export function SignupCompleteScreen({
  title,
  token: tokenProp,
  loggedInHref = "/",
  loginHref = "/login",
}: SignupCompleteScreenProps): ReactNode {
  const t = useTranslation();
  const [token] = useState(() => tokenProp ?? parseUrlToken());
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError(t("auth.signupComplete.tooShort"));
      return;
    }
    if (password !== confirmPassword) {
      setError(t("auth.signupComplete.mismatch"));
      return;
    }
    setSubmitting(true);
    const res = await confirmSignup(token, password);
    setSubmitting(false);
    if (res.ok) {
      // Auto-Login: Cookies sind via Set-Cookie schon im Browser. Wir
      // schicken den User direkt zur eingeloggten Page.
      const target =
        typeof loggedInHref === "function"
          ? loggedInHref({ tenantKey: res.data.tenantKey })
          : loggedInHref;
      window.location.assign(target);
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

  const effectiveTitle = title ?? t("auth.signupComplete.title");

  // Kein Token in der URL → klare Message statt Form ohne Token
  // (würde nur invalidSignupToken zeigen, verwirrend).
  if (token === "") {
    return (
      <AuthCard title={effectiveTitle}>
        <div className="p-6 pt-0 flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">{t("auth.signupComplete.missingToken")}</p>
          <a href={loginHref} className={authMutedLinkClass}>
            {t("auth.signup.haveAccount")}
          </a>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard title={effectiveTitle}>
      <form onSubmit={onSubmit} className="flex flex-col gap-4 p-6 pt-0">
        <p className="text-sm text-muted-foreground">{t("auth.signupComplete.intro")}</p>
        <AuthInput
          id="signup-password"
          label={t("auth.signupComplete.password")}
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          disabled={submitting}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <AuthInput
          id="signup-confirm-password"
          label={t("auth.signupComplete.confirmPassword")}
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          disabled={submitting}
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
        />
        {error !== null && <AuthBanner tone="error">{error}</AuthBanner>}
        <button type="submit" disabled={submitting} className={authButtonClass}>
          {submitting ? t("auth.signupComplete.submitting") : t("auth.signupComplete.submit")}
        </button>
      </form>
    </AuthCard>
  );
}
