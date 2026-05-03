// @runtime client
// ResetPasswordScreen — liest `?token=...` aus der URL, zeigt Form mit
// new + confirm-password. Submit triggert /api/auth/reset-password mit
// dem Token. Server collapses alle Token-Verify-Failures auf einen
// Code (anti-enumeration); UI zeigt unified "Link ungültig oder
// abgelaufen"-message.
//
// Token-Quelle ist read-once: wir lesen `window.location.search`
// einmalig im useState-Initializer. Apps die das anders brauchen
// (server-injected Token-Prop, andere Parameter-Namen) reichen einen
// expliziten `token` als Prop durch.

import { useTranslation } from "@kumiko/renderer";
import { cn } from "@kumiko/renderer-web";
import { type ReactNode, useState } from "react";
import { resetPassword } from "./auth-client";

export type ResetPasswordScreenProps = {
  readonly title?: string;
  /** Override für den Token aus der URL — Apps die per server-side-
   *  Render einen Token reinreichen, brauchen das. Default: parsed aus
   *  `?token=...` in der URL. */
  readonly token?: string;
  /** href für "Zum Login"-Link nach Success. Default "/login". */
  readonly loginHref?: string;
};

function readTokenFromUrl(): string {
  if (typeof window === "undefined") return "";
  const params = new URLSearchParams(window.location.search);
  return params.get("token") ?? "";
}

export function ResetPasswordScreen({
  title,
  token: tokenProp,
  loginHref = "/login",
}: ResetPasswordScreenProps): ReactNode {
  const t = useTranslation();
  const [token] = useState(() => tokenProp ?? readTokenFromUrl());
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
    setError(t("auth.errors.unknownError"));
  };

  const inputClass =
    "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm " +
    "transition-colors placeholder:text-muted-foreground focus-visible:outline-none " +
    "focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

  const effectiveTitle = title ?? t("auth.resetPassword.title");

  // Kein Token in der URL → User soll den Link aus seiner Mail nochmal
  // klicken oder einen neuen Reset anfordern. Form ohne Token zu
  // submitten würde nur den invalidResetToken-Error zeigen — das ist
  // verwirrend. Lieber upfront eine klare Message.
  if (token === "") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <div className="w-full max-w-sm rounded-lg border bg-card text-card-foreground shadow-sm p-6">
          <h1 className="text-xl font-semibold tracking-tight mb-4">{effectiveTitle}</h1>
          <p className="text-sm text-muted-foreground mb-4">
            {t("auth.resetPassword.missingToken")}
          </p>
          <a
            href={loginHref}
            className="text-sm text-muted-foreground hover:text-foreground underline-offset-4 hover:underline"
          >
            {t("auth.resetPassword.goToLogin")}
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-lg border bg-card text-card-foreground shadow-sm">
        <div className="flex flex-col space-y-1.5 p-6 pb-4">
          <h1 className="text-xl font-semibold tracking-tight">{effectiveTitle}</h1>
        </div>
        {done ? (
          <div className="p-6 pt-0 flex flex-col gap-4">
            <div
              role="status"
              className="rounded-md border border-border bg-muted px-4 py-3 text-sm text-muted-foreground"
            >
              <p className="font-medium text-foreground">{t("auth.resetPassword.successTitle")}</p>
              <p className="mt-1">{t("auth.resetPassword.successBody")}</p>
            </div>
            <a
              href={loginHref}
              className={cn(
                "inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium",
                "bg-primary text-primary-foreground shadow hover:bg-primary/90 h-9 px-4 py-2",
              )}
            >
              {t("auth.resetPassword.goToLogin")}
            </a>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="flex flex-col gap-4 p-6 pt-0">
            <p className="text-sm text-muted-foreground">{t("auth.resetPassword.intro")}</p>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="reset-new-password" className="text-sm font-medium leading-none">
                {t("auth.resetPassword.newPassword")}
              </label>
              <input
                id="reset-new-password"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                disabled={submitting}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className={inputClass}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="reset-confirm-password" className="text-sm font-medium leading-none">
                {t("auth.resetPassword.confirmPassword")}
              </label>
              <input
                id="reset-confirm-password"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                disabled={submitting}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className={inputClass}
              />
            </div>
            {error !== null && (
              <div
                role="alert"
                className={cn(
                  "relative w-full rounded-md border px-4 py-3 text-sm",
                  "border-destructive/50 text-destructive bg-destructive/10 dark:border-destructive",
                )}
              >
                {error}
              </div>
            )}
            <button
              type="submit"
              disabled={submitting}
              className={cn(
                "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors",
                "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                "disabled:pointer-events-none disabled:opacity-50",
                "bg-primary text-primary-foreground shadow hover:bg-primary/90 h-9 px-4 py-2",
              )}
            >
              {submitting ? t("auth.resetPassword.submitting") : t("auth.resetPassword.submit")}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
