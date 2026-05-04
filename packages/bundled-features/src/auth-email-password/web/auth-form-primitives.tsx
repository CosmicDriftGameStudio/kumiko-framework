// @runtime client
// Shared Web-Primitives für die Auth-Screens. Nur noch Layout/Style-
// Helpers — Form/Field/Input/Button/Banner kommen jetzt über
// usePrimitives() aus dem Framework-Vertrag, damit Native dieselben
// Auth-Screens rendern kann (renderer-native registriert eigene
// Implementations).
//
//   <AuthCard>          — Card-Wrapper für die Auth-Screen-Layouts
//                         (full-screen, zentriert, max-w-sm). Web-only;
//                         eine Native-Variante landet bei Bedarf
//                         daneben (z.B. SafeArea + ScrollView).
//   authButtonClass     — Tailwind-Class für anchor-styled-as-button
//                         (z.B. "Zum Login"-Link nach Reset-Success).
//                         Nur dort, wo ein <a>-Tag rendert.
//   authMutedLinkClass  — Subtle-Link-Style.
//   parseUrlToken       — URL-Param-Helper (window.location.search).

import { cn } from "@kumiko/renderer-web";
import type { ReactNode } from "react";

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

// Primary-button-Style für anchor-Tags die wie ein Button aussehen
// (z.B. "Zum Login"-Link nach Reset-Success — kein <Button> weil <a>).
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
