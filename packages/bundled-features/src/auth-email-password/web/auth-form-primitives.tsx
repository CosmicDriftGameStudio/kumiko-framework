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
//   parseUrlToken       — URL-Param-Helper (window.location.search).
//
// Link-Styles laufen über das Link-Primitive (variant="button"/"muted") —
// die früheren authButtonClass/authMutedLinkClass sind dorthin gewandert.

import { usePrimitives } from "@cosmicdrift/kumiko-renderer";
import { BareFormProvider } from "@cosmicdrift/kumiko-renderer-web";
import { createContext, type ReactNode, useContext, useEffect, useState } from "react";

// Wrappt die zentrierte Auth-Card in ihre Umgebung. Default = Fullscreen-
// zentriert (Standalone-Auth-Page). Eine Apex-/Marketing-Chrome reicht über
// AuthShellProvider eine eigene Variante rein, ohne dass `min-h-screen` die
// Chrome übermalt.
export type AuthShellRenderer = (card: ReactNode) => ReactNode;

const defaultAuthShell: AuthShellRenderer = (card) => (
  <div className="min-h-screen flex items-center justify-center bg-background px-4">{card}</div>
);

const AuthShellContext = createContext<AuthShellRenderer | null>(null);

export function AuthShellProvider({
  shell,
  children,
}: {
  readonly shell: AuthShellRenderer;
  readonly children: ReactNode;
}): ReactNode {
  return <AuthShellContext.Provider value={shell}>{children}</AuthShellContext.Provider>;
}

export function useAuthShell(): AuthShellRenderer | null {
  return useContext(AuthShellContext);
}

export type AuthCardProps = {
  readonly title?: string;
  readonly subtitle?: ReactNode;
  readonly children: ReactNode;
};

export function AuthCard({ title, subtitle, children }: AuthCardProps): ReactNode {
  const { Card } = usePrimitives();
  const shell = useAuthShell() ?? defaultAuthShell;
  // h1 (Seiten-Hauptüberschrift) via Header-Slot erhalten — die Card-Default-
  // Header wäre h3. padded:false = Form sitzt randlos wie bisher (bare form).
  const card = (
    <Card
      className="w-full max-w-sm"
      options={{ padded: false }}
      slots={{
        header:
          title !== undefined || subtitle !== undefined ? (
            <div className="flex flex-col space-y-1.5 p-6 pb-4">
              {title !== undefined && (
                <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
              )}
              {subtitle !== undefined && (
                <p className="text-sm text-muted-foreground">{subtitle}</p>
              )}
            </div>
          ) : undefined,
      }}
    >
      <BareFormProvider>{children}</BareFormProvider>
    </Card>
  );
  return shell(card);
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

// Reads the magic-link token from `?<paramName>=` once on mount, then strips
// that param from the URL via history.replaceState so the single-use token
// doesn't linger in browser history / Referer (#774). An explicit `override`
// (server-injected token) short-circuits both the URL read and the scrub.
export function useUrlToken(override?: string, paramName = "token"): string {
  const [token] = useState(() => override ?? parseUrlToken(paramName));
  useEffect(() => {
    if (override !== undefined) return;
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (!url.searchParams.has(paramName)) return;
    url.searchParams.delete(paramName);
    window.history.replaceState(window.history.state, "", url.toString());
  }, [override, paramName]);
  return token;
}
