// @runtime client
// Shared UI-Primitives für die Auth-Screens (Login, ForgotPassword,
// ResetPassword, VerifyEmail). Drei Komponenten:
//
//   <AuthCard>      — der zentrale Card-Wrapper (full-screen, zentriert).
//   <AuthInput>     — labelled text-input mit konsistenten Tailwind-classes.
//   authButtonClass — String-helper für button/anchor-classes (primary).
//
// Memory feedback_test_setup_centralize.md: zentralisieren bevor das
// 3 Mal kopiert wird. Pattern war beim LoginScreen schon da, aber
// inline. Mit den drei neuen Screens (forgot/reset/verify) hätte sich
// das auf 4 Files verteilt — daher jetzt einmal extrahiert.
//
// LoginScreen wird bewusst NICHT auf diese Primitives umgebaut — das
// wäre ein touch der nichts mit Sprint U.1 zu tun hat. Wenn LoginScreen
// das nächste Mal angefasst wird, kann er hierher umziehen.

import { cn } from "@kumiko/renderer-web";
import type { InputHTMLAttributes, ReactNode } from "react";

export type AuthCardProps = {
  readonly title?: string;
  readonly subtitle?: ReactNode;
  readonly children: ReactNode;
};

export function AuthCard({ title, subtitle, children }: AuthCardProps): ReactNode {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-lg border bg-card text-card-foreground shadow-sm">
        {(title !== undefined || subtitle !== undefined) && (
          <div className="flex flex-col space-y-1.5 p-6 pb-4">
            {title !== undefined && (
              <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
            )}
            {subtitle !== undefined && <p className="text-sm text-muted-foreground">{subtitle}</p>}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

// Input mit zentralisierter className. Apps die andere Border-Radien /
// Padding wollen, ersetzen das ganze Bundle via emailPasswordClient -
// override (kein per-Field-className-Prop hier weil Drift-Risiko).
const inputClass =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm " +
  "transition-colors placeholder:text-muted-foreground focus-visible:outline-none " +
  "focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

export type AuthInputProps = InputHTMLAttributes<HTMLInputElement> & {
  readonly label: string;
};

export function AuthInput({ id, label, ...rest }: AuthInputProps): ReactNode {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium leading-none">
        {label}
      </label>
      <input id={id} className={inputClass} {...rest} />
    </div>
  );
}

// Primary-button-Style. Als String exportiert weil die Auth-Screens
// teils <button> teils <a> nutzen — JSX-Component müsste beide cases
// abdecken und würde mehr Boilerplate erzeugen als sie ersparen.
export const authButtonClass = cn(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors",
  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
  "disabled:pointer-events-none disabled:opacity-50",
  "bg-primary text-primary-foreground shadow hover:bg-primary/90 h-9 px-4 py-2",
);

// Subtle-Link-Style (für "Zurück zum Login"-Anchors). Fixed margin/
// alignment-classes lassen wir den Caller setzen — nur Farbe + hover.
export const authMutedLinkClass =
  "text-sm text-muted-foreground hover:text-foreground underline-offset-4 hover:underline";

// Error/Status-Banner — error: rot/destructive, status: muted. Beide
// nehmen Children damit der Caller frei rendern kann.
export type AuthBannerProps = {
  readonly tone: "error" | "status";
  readonly children: ReactNode;
};

export function AuthBanner({ tone, children }: AuthBannerProps): ReactNode {
  if (tone === "error") {
    return (
      <div
        role="alert"
        className={cn(
          "relative w-full rounded-md border px-4 py-3 text-sm",
          "border-destructive/50 text-destructive bg-destructive/10 dark:border-destructive",
        )}
      >
        {children}
      </div>
    );
  }
  return (
    <div
      role="status"
      className="rounded-md border border-border bg-muted px-4 py-3 text-sm text-muted-foreground"
    >
      {children}
    </div>
  );
}

// Liest `?<paramName>=<value>` aus der aktuellen URL — typisches
// Pattern für Token-bearing Pages (reset, verify). Returnt "" wenn der
// Browser nicht da ist (SSR-safety) oder der Parameter fehlt.
//
// Nicht über useState/useEffect - das wäre ein read-once-on-mount
// pattern aber URL-changes sind hier irrelevant (Token-Pages re-loaden
// für neue Tokens). Caller setzt useState(() => parseUrlToken(...)) wenn
// gewünscht.
export function parseUrlToken(paramName = "token"): string {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get(paramName) ?? "";
}
