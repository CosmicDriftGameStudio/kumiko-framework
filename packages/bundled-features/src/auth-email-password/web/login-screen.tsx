// @runtime client
// Default-LoginScreen. Reine E-Mail-+-Passwort-Form, zentriert, Card-
// Layout. Texte kommen aus `useTranslation()` — die Default-Bundles
// (de+en) liefert das Feature selber mit (translations.ts); Apps die
// was anderes wollen, setzen entweder einen eigenen LocaleResolver auf
// App-Level oder reichen Key-Overrides an `emailPasswordClient()`.
//
// Die Reason-Codes aus dem Login-Handler werden 1:1 auf i18n-Keys
// gemappt (reasonToI18nKey) — neue Reason-Codes brauchen nur eine
// neue Zeile im Bundle + hier im Mapping.

import { useTranslation } from "@kumiko/renderer";
import { cn } from "@kumiko/renderer-web";
import { type ReactNode, useState } from "react";
import type { LoginFailure } from "./auth-client";
import { useSession } from "./session";

export type LoginScreenProps = {
  /** Overridet den `auth.login.title`-i18n-Key. Nur setzen wenn der
   *  Titel stark app-branded ist und keine Translation braucht. */
  readonly title?: string;
  readonly subtitle?: ReactNode;
  readonly submitLabel?: string;
  /** Optional href zum ForgotPasswordScreen. Wenn gesetzt rendert die
   *  LoginScreen unter dem Submit-Button einen "Passwort vergessen?"-
   *  Link. Apps die den Reset-Flow NICHT anbieten (z.B. nur Magic-Link),
   *  setzen das einfach nicht — Login bleibt minimalistisch. */
  readonly forgotPasswordHref?: string;
};

// Map vom Reason-Code des Login-Handlers auf einen i18n-Key plus
// optional extrahierte Interpolations-Parameter. Ungekannte Codes
// fallen auf `auth.errors.loginFailed` zurück.
function reasonToKey(failure: LoginFailure): {
  readonly key: string;
  readonly params?: Readonly<Record<string, unknown>>;
} {
  switch (failure.reason) {
    case "invalid_credentials":
      return { key: "auth.errors.invalidCredentials" };
    case "no_membership":
      return { key: "auth.errors.noMembership" };
    case "account_locked":
      if (failure.retryAfterSeconds !== undefined) {
        return {
          key: "auth.errors.accountLockedRetry",
          params: { minutes: Math.ceil(failure.retryAfterSeconds / 60) },
        };
      }
      return { key: "auth.errors.accountLocked" };
    case "email_not_verified":
      return { key: "auth.errors.emailNotVerified" };
    case "rate_limited":
      return { key: "auth.errors.rateLimited" };
    case "invalid_body":
      return { key: "auth.errors.invalidBody" };
    default:
      return { key: "auth.errors.loginFailed" };
  }
}

export function LoginScreen({
  title,
  subtitle,
  submitLabel,
  forgotPasswordHref,
}: LoginScreenProps): ReactNode {
  const t = useTranslation();
  const session = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<LoginFailure | null>(null);

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const res = await session.login({ email, password });
    setSubmitting(false);
    if (!res.ok) setError(res.error);
  };

  const inputClass =
    "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm " +
    "transition-colors placeholder:text-muted-foreground focus-visible:outline-none " +
    "focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

  const effectiveTitle = title ?? t("auth.login.title");
  const effectiveSubmit = submitLabel ?? t("auth.login.submit");

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-lg border bg-card text-card-foreground shadow-sm">
        <div className="flex flex-col space-y-1.5 p-6 pb-4">
          <h1 className="text-xl font-semibold tracking-tight">{effectiveTitle}</h1>
          {subtitle !== undefined && <p className="text-sm text-muted-foreground">{subtitle}</p>}
        </div>
        <form onSubmit={onSubmit} className="flex flex-col gap-4 p-6 pt-0">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="login-email" className="text-sm font-medium leading-none">
              {t("auth.login.email")}
            </label>
            <input
              id="login-email"
              type="email"
              autoComplete="email"
              required
              disabled={submitting}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputClass}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="login-password" className="text-sm font-medium leading-none">
              {t("auth.login.password")}
            </label>
            <input
              id="login-password"
              type="password"
              autoComplete="current-password"
              required
              disabled={submitting}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
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
              {(() => {
                const { key, params } = reasonToKey(error);
                return t(key, params);
              })()}
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
            {submitting ? t("auth.login.submitting") : effectiveSubmit}
          </button>
          {forgotPasswordHref !== undefined && (
            <a
              href={forgotPasswordHref}
              className="text-sm text-muted-foreground hover:text-foreground underline-offset-4 hover:underline self-center"
            >
              {t("auth.login.forgotPassword")}
            </a>
          )}
        </form>
      </div>
    </div>
  );
}
