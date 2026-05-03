// @runtime client
// ForgotPasswordScreen — Form mit email-input. Submit triggert
// /api/auth/request-password-reset (silent-success, kein account-
// enumeration). UI zeigt unconditional ein "Wenn Account existiert,
// Mail unterwegs"-Confirm — auch wenn der Server intern erkannt hat
// dass die Email nicht existiert.
//
// App ist verantwortlich, den Screen unter einer URL zu mounten (z.B.
// /forgot-password) und ihn zu erreichen — der LoginScreen kann einen
// "Passwort vergessen?"-Link auf die App-Route setzen.

import { useTranslation } from "@kumiko/renderer";
import { cn } from "@kumiko/renderer-web";
import { type ReactNode, useState } from "react";
import { requestPasswordReset } from "./auth-client";

export type ForgotPasswordScreenProps = {
  readonly title?: string;
  readonly subtitle?: ReactNode;
  /** href für den "Zurück zum Login"-Link in success + form. App-
   *  spezifisch — Default "/login". */
  readonly loginHref?: string;
};

export function ForgotPasswordScreen({
  title,
  subtitle,
  loginHref = "/login",
}: ForgotPasswordScreenProps): ReactNode {
  const t = useTranslation();
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await requestPasswordReset(email);
      setDone(true);
    } catch {
      setError(t("auth.errors.unknownError"));
    } finally {
      setSubmitting(false);
    }
  };

  const inputClass =
    "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm " +
    "transition-colors placeholder:text-muted-foreground focus-visible:outline-none " +
    "focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

  const effectiveTitle = title ?? t("auth.forgotPassword.title");

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-lg border bg-card text-card-foreground shadow-sm">
        <div className="flex flex-col space-y-1.5 p-6 pb-4">
          <h1 className="text-xl font-semibold tracking-tight">{effectiveTitle}</h1>
          {subtitle !== undefined && <p className="text-sm text-muted-foreground">{subtitle}</p>}
        </div>
        {done ? (
          <div className="p-6 pt-0 flex flex-col gap-4">
            <div
              role="status"
              className="rounded-md border border-border bg-muted px-4 py-3 text-sm text-muted-foreground"
            >
              <p className="font-medium text-foreground">{t("auth.forgotPassword.successTitle")}</p>
              <p className="mt-1">{t("auth.forgotPassword.successBody")}</p>
            </div>
            <a
              href={loginHref}
              className="text-sm text-muted-foreground hover:text-foreground underline-offset-4 hover:underline"
            >
              {t("auth.forgotPassword.backToLogin")}
            </a>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="flex flex-col gap-4 p-6 pt-0">
            <p className="text-sm text-muted-foreground">{t("auth.forgotPassword.intro")}</p>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="forgot-email" className="text-sm font-medium leading-none">
                {t("auth.forgotPassword.email")}
              </label>
              <input
                id="forgot-email"
                type="email"
                autoComplete="email"
                required
                disabled={submitting}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
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
              {submitting ? t("auth.forgotPassword.submitting") : t("auth.forgotPassword.submit")}
            </button>
            <a
              href={loginHref}
              className="text-sm text-muted-foreground hover:text-foreground underline-offset-4 hover:underline self-center"
            >
              {t("auth.forgotPassword.backToLogin")}
            </a>
          </form>
        )}
      </div>
    </div>
  );
}
