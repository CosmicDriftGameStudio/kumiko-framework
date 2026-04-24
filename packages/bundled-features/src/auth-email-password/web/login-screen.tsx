// Default-LoginScreen. Reine E-Mail-+-Passwort-Form, zentriert,
// Card-Layout. Fehlermeldungen sind knapp und generisch — exakt die
// Reason-Codes die der Login-Handler zurückliefert (invalid_credentials,
// account_locked, rate_limited, no_membership). App-Code kann den
// Screen überschreiben via `createKumikoApp({ loginScreen })`.
//
// Keine Primitives — wir wollen das unabhängig vom Feature-Form-Stack
// rendern können, weil AuthGate vor jeder Screen-Mount steht und vor
// <PrimitivesProvider> leben muss (Provider werden von createKumikoApp
// hierunter gemountet).

import { type ClassValue, clsx } from "clsx";
import { type ReactNode, useState } from "react";
import { twMerge } from "tailwind-merge";
import type { LoginFailure } from "./auth-client";
import { useSession } from "./session";

// Lokaler cn-Helper — 1:1 Dublette von renderer-web/src/lib/cn.ts.
// Das Feature soll unabhängig von renderer-web-Interna bleiben;
// eine Utils-Auslagerung macht erst Sinn wenn das dritte Feature
// dieselben Zeilen braucht.
function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export type LoginScreenProps = {
  readonly title?: string;
  readonly subtitle?: ReactNode;
  readonly submitLabel?: string;
};

function reasonToMessage(failure: LoginFailure): string {
  switch (failure.reason) {
    case "invalid_credentials":
      return "E-Mail oder Passwort falsch.";
    case "no_membership":
      return "Dieses Konto hat keinen Tenant-Zugang.";
    case "account_locked":
      return failure.retryAfterSeconds !== undefined
        ? `Konto gesperrt. Neuer Versuch in ${Math.ceil(failure.retryAfterSeconds / 60)} Minuten.`
        : "Konto vorübergehend gesperrt.";
    case "email_not_verified":
      return "E-Mail-Adresse noch nicht bestätigt.";
    case "rate_limited":
      return "Zu viele Login-Versuche. Bitte kurz warten.";
    case "invalid_body":
      return "Ungültige Eingabe.";
    default:
      return failure.message ?? "Login fehlgeschlagen.";
  }
}

export function LoginScreen({
  title = "Anmelden",
  subtitle,
  submitLabel = "Einloggen",
}: LoginScreenProps): ReactNode {
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

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-lg border bg-card text-card-foreground shadow-sm">
        <div className="flex flex-col space-y-1.5 p-6 pb-4">
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          {subtitle !== undefined && <p className="text-sm text-muted-foreground">{subtitle}</p>}
        </div>
        <form onSubmit={onSubmit} className="flex flex-col gap-4 p-6 pt-0">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="login-email" className="text-sm font-medium leading-none">
              E-Mail
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
              Passwort
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
              {reasonToMessage(error)}
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
            {submitting ? "…" : submitLabel}
          </button>
        </form>
      </div>
    </div>
  );
}
