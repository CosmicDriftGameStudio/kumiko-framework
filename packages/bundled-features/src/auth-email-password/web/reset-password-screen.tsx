// @runtime client
// ResetPasswordScreen — liest `?token=...` aus der URL, zeigt Form mit
// new + confirm-password. Submit triggert /api/auth/reset-password mit
// dem Token. Server collapses alle Token-Verify-Failures auf einen
// Code (anti-enumeration); UI zeigt unified "Link ungültig oder
// abgelaufen"-message.
//
// Token-Quelle ist read-once: wir lesen via parseUrlToken() einmalig
// im useState-Initializer. Apps die das anders brauchen (server-
// injected Token-Prop, andere Parameter-Namen) reichen einen
// expliziten `token` als Prop durch.

import { useTranslation } from "@kumiko/renderer";
import { type ReactNode, useState } from "react";
import { resetPassword } from "./auth-client";
import {
  AuthBanner,
  AuthCard,
  AuthInput,
  authButtonClass,
  authMutedLinkClass,
  parseUrlToken,
} from "./auth-form-primitives";

export type ResetPasswordScreenProps = {
  readonly title?: string;
  /** Override für den Token aus der URL — Apps die per server-side-
   *  Render einen Token reinreichen, brauchen das. Default: parsed aus
   *  `?token=...` in der URL. */
  readonly token?: string;
  /** href für "Zum Login"-Link nach Success. Default "/login". */
  readonly loginHref?: string;
};

export function ResetPasswordScreen({
  title,
  token: tokenProp,
  loginHref = "/login",
}: ResetPasswordScreenProps): ReactNode {
  const t = useTranslation();
  const [token] = useState(() => tokenProp ?? parseUrlToken());
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    setError(null);
    if (newPassword.length < 8) {
      setError(t("auth.resetPassword.tooShort"));
      return;
    }
    if (newPassword !== confirmPassword) {
      setError(t("auth.resetPassword.mismatch"));
      return;
    }
    setSubmitting(true);
    const res = await resetPassword(token, newPassword);
    setSubmitting(false);
    if (res.ok) {
      setDone(true);
      return;
    }
    // Server-collapsed Token-failures → single i18n key.
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

  const effectiveTitle = title ?? t("auth.resetPassword.title");

  // Kein Token in der URL → User soll den Link aus seiner Mail nochmal
  // klicken oder einen neuen Reset anfordern. Form ohne Token zu
  // submitten würde nur den invalidResetToken-Error zeigen — das ist
  // verwirrend. Lieber upfront eine klare Message.
  if (token === "") {
    return (
      <AuthCard title={effectiveTitle}>
        <div className="p-6 pt-0 flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">{t("auth.resetPassword.missingToken")}</p>
          <a href={loginHref} className={authMutedLinkClass}>
            {t("auth.resetPassword.goToLogin")}
          </a>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard title={effectiveTitle}>
      {done ? (
        <div className="p-6 pt-0 flex flex-col gap-4">
          <AuthBanner tone="status">
            <p className="font-medium text-foreground">{t("auth.resetPassword.successTitle")}</p>
            <p className="mt-1">{t("auth.resetPassword.successBody")}</p>
          </AuthBanner>
          <a href={loginHref} className={authButtonClass}>
            {t("auth.resetPassword.goToLogin")}
          </a>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="flex flex-col gap-4 p-6 pt-0">
          <p className="text-sm text-muted-foreground">{t("auth.resetPassword.intro")}</p>
          <AuthInput
            id="reset-new-password"
            label={t("auth.resetPassword.newPassword")}
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            disabled={submitting}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />
          <AuthInput
            id="reset-confirm-password"
            label={t("auth.resetPassword.confirmPassword")}
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
            {submitting ? t("auth.resetPassword.submitting") : t("auth.resetPassword.submit")}
          </button>
        </form>
      )}
    </AuthCard>
  );
}
