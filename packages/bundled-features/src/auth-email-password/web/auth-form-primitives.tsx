// Shared web primitives for the auth screens. Only layout/style helpers are
// left here; Form/Field/Input/Button/Banner come through usePrimitives() from
// the framework contract, so apps and tests can override the implementations
// via PrimitivesProvider.
//
//   <AuthCard>          — card wrapper for the auth screen layouts
//                         (full-screen, centered, max-w-sm). Web-only.
//   parseUrlToken       — URL param helper (window.location.search).
//
// Link styles go through the Link primitive (variant="button"/"muted"); the
// former authButtonClass/authMutedLinkClass moved there.

import { usePrimitives } from "@cosmicdrift/kumiko-renderer";
import { BareFormProvider, cn } from "@cosmicdrift/kumiko-renderer/web";
import { createContext, type ReactNode, useContext, useEffect, useState } from "react";

// Wraps the centered auth card in its surrounding layout. The default is
// // fullscreen-centered for standalone auth pages. Apex/marketing chrome can
// // provide its own variant through AuthShellProvider without `min-h-screen`
// // covering that chrome.
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
  /** Merged onto the Card (default `w-full max-w-sm`). */
  readonly className?: string;
  readonly headerClassName?: string;
  readonly titleClassName?: string;
  /** Merged onto the body wrapper (default `p-6 pt-0 flex flex-col gap-4`). */
  readonly bodyClassName?: string;
  readonly children: ReactNode;
};

// kumiko-lint-ignore no-custom-primitives Wraps usePrimitives().Card, pure domain name for the auth-screen chrome, not a primitive reimplementation
export function AuthCard({
  title,
  subtitle,
  className,
  headerClassName,
  titleClassName,
  bodyClassName,
  children,
}: AuthCardProps): ReactNode {
  const { Card } = usePrimitives();
  const shell = useAuthShell() ?? defaultAuthShell;
  // Keep an h1 (page heading) through the header slot; the Card's default
  // header would be h3. padded:false keeps the form edge-to-edge as before
  // (bare form).
  const card = (
    <Card
      className={cn("w-full max-w-sm", className)}
      options={{ padded: false }}
      slots={{
        header:
          title !== undefined || subtitle !== undefined ? (
            <div className={cn("flex flex-col space-y-1.5 p-6 pb-4", headerClassName)}>
              {title !== undefined && (
                <h1 className={cn("text-xl font-semibold tracking-tight", titleClassName)}>
                  {title}
                </h1>
              )}
              {subtitle !== undefined && (
                <p className="text-sm text-muted-foreground">{subtitle}</p>
              )}
            </div>
          ) : undefined,
      }}
    >
      <BareFormProvider>
        <div className={cn("p-6 pt-0 flex flex-col gap-4", bodyClassName)}>{children}</div>
      </BareFormProvider>
    </Card>
  );
  return shell(card);
}

// Reads `?<paramName>=<value>` from the current URL, as used by token-bearing
// // pages (reset, verify). Returns "" during SSR or when the parameter is absent.
//
// // This is intentionally not read through useState/useEffect: that would be a
// // read-once-on-mount pattern, while URL changes are irrelevant here because
// // token pages reload for new tokens. Callers can use
// // useState(() => parseUrlToken(...)) when needed.
export function parseUrlToken(paramName = "token"): string {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get(paramName) ?? "";
}

// Reads the magic-link token from `?<paramName>=` once on mount, then strips
// that param from the URL via history.replaceState so the single-use token
// doesn't linger in browser history / Referer. An explicit `override`
// (server-injected token) short-circuits both the URL read and the scrub.
export function useUrlToken(override?: string, paramName = "token"): string {
  const [token] = useState(() => override ?? parseUrlToken(paramName));
  // kumiko-lint-ignore no-raw-hooks DOM integration: history.replaceState scrubs the token from browser history once, no framework query/mutation equivalent
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
