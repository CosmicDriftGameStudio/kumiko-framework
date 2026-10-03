// @runtime client
// Auth-Gate: rendert den LoginScreen solange der Session-Status
// "unauthenticated" ist, sonst die Kinder. "loading" zeigt einen
// minimalen Placeholder — die initiale Refresh-Runde liefert in der
// Regel in <100ms, also kein Spinner-Overkill.
//
// Die Factory makeAuthGate schließt die LoginScreen-Komponente in,
// damit das Gate der ClientFeatureDefinition-Signatur entspricht
// (nur `{ children }`-Prop). Der Sample kann so einen eigenen Login-
// Screen rein konfigurieren, ohne den Gate selbst ersetzen zu müssen.

import { type ComponentType, type ReactNode, useEffect, useState } from "react";
import { assertNavigableUrl, buildLoginRedirectUrl } from "./auth-redirect.js";
import { LoginScreen, type LoginScreenProps } from "./login-screen.js";
import { SessionProvider, useSession } from "./session.js";
import { SessionBootstrapErrorScreen } from "./session-bootstrap-error.js";

// Generic — NOT auth-mfa's MfaVerifyScreenProps directly, so this feature
// stays unaware of auth-mfa's concrete shape (same coupling direction as
// login.write.ts's mfaStatusChecker callback on the server side). Apps
// wire auth-mfa's MfaVerifyScreen in here via EmailPasswordClientOptions.
export type MfaVerifyComponentProps = {
  readonly challengeToken: string;
  readonly onSuccess?: () => void;
  readonly onCancel?: () => void;
};

// Same coupling reasoning as MfaVerifyComponentProps above — generic, not
// auth-mfa's MfaSetupPreauthScreenProps directly. Apps wire auth-mfa's
// MfaSetupPreauthScreen in here via EmailPasswordClientOptions.
export type MfaSetupComponentProps = {
  readonly preauthSetupToken: string;
  readonly accountLabel: string;
  readonly onSuccess?: () => void;
  readonly onCancel?: () => void;
};

export type LoginRouteOptions = {
  readonly loginScreen?: ComponentType<LoginScreenProps>;
  readonly loginScreenProps?: LoginScreenProps;
  readonly mfaVerifyScreen?: ComponentType<MfaVerifyComponentProps>;
  readonly mfaSetupScreen?: ComponentType<MfaSetupComponentProps>;
  /** Called once the session becomes authenticated. makeAuthGate ignores
   *  this (it renders `children` on its own authenticated branch instead);
   *  standalone routes — no parent gate, e.g. an anonymous apex/marketing
   *  surface — use it to redirect. */
  readonly onAuthenticated?: () => void;
};

// The one sanctioned way to render a login flow that correctly completes
// an MFA challenge — makeAuthGate below is just this wrapped for the
// `{ children }` gate shape. Also exported directly for apps that render
// their own standalone login route outside any gate (createPublicSurface
// apex pages stack providers, not gates — see auth-mount.tsx recipes).
// Handing an app raw LoginScreen + telling it to hand-roll the challenge-
// token swap itself is exactly how kumiko-framework#266's login-time MFA
// step went missing in a real apex surface; this prevents the *most common*
// version of that mistake. MFA still only actually works once a consumer
// wires `mfaVerifyScreen` — omitting it is a silent no-MFA fallback, not
// something this route can catch on its own (auth-mfa is a separate,
// optional package).
export function createLoginRoute(
  opts: LoginRouteOptions = {},
): ComponentType<Record<string, never>> {
  const LoginComponent = opts.loginScreen ?? LoginScreen;
  const MfaVerifyComponent = opts.mfaVerifyScreen;
  const MfaSetupComponent = opts.mfaSetupScreen;

  function LoginRoute(): ReactNode {
    const { status, refresh, bootstrapFailure, logout } = useSession();
    const { onAuthenticated } = opts;
    // Pending challenge-token from LoginScreen's onMfaChallenge. Lives here
    // (not in SessionState) because it's a UI-only transition — the server
    // never considers this session authenticated until verify succeeds.
    const [challengeToken, setChallengeToken] = useState<string | null>(null);
    const [setupRequest, setSetupRequest] = useState<{
      readonly preauthSetupToken: string;
      readonly accountLabel: string;
    } | null>(null);

    // kumiko-lint-ignore no-raw-hooks Phase-3 conversion tracked in #2312
    useEffect(() => {
      if (status === "authenticated") onAuthenticated?.();
    }, [status]);

    if (status === "loading") {
      return (
        <div className="min-h-screen flex items-center justify-center text-muted-foreground text-sm" />
      );
    }
    if (status === "error" && bootstrapFailure !== null) {
      return (
        <SessionBootstrapErrorScreen
          failure={bootstrapFailure}
          onRetry={refresh}
          onSignOut={logout}
        />
      );
    }
    // A standalone mount (no parent gate, no onAuthenticated wired — e.g. an
    // apex/marketing surface that just places <LoginRoute /> directly) has no
    // way to navigate away once authenticated. Blanking the page there is a
    // regression against the old raw LoginScreen (which had no session check
    // at all); fall through to the form instead. A route WITH onAuthenticated
    // still returns null and trusts the effect above to redirect.
    if (status === "authenticated" && onAuthenticated) return null;
    if (challengeToken !== null && MfaVerifyComponent) {
      return (
        <MfaVerifyComponent
          challengeToken={challengeToken}
          onSuccess={() => setChallengeToken(null)}
          onCancel={() => setChallengeToken(null)}
        />
      );
    }
    // Pending preauthSetupToken from LoginScreen's onMfaSetupRequired. Same
    // reasoning as challengeToken — a UI-only transition, not session state.
    if (setupRequest !== null && MfaSetupComponent) {
      return (
        <MfaSetupComponent
          preauthSetupToken={setupRequest.preauthSetupToken}
          accountLabel={setupRequest.accountLabel}
          onSuccess={() => {
            // MfaSetupPreauthScreen has no session to refresh itself with
            // (it runs pre-auth) — the gate owns the session, so it refreshes.
            // refresh() never rejects: a failed refresh surfaces as status
            // "error" (bootstrap error screen with retry), so only the
            // success path needs to clear setupRequest.
            void refresh().then(() => setSetupRequest(null));
          }}
          onCancel={() => setSetupRequest(null)}
        />
      );
    }
    return (
      <LoginComponent
        {...opts.loginScreenProps}
        onMfaChallenge={
          MfaVerifyComponent ? setChallengeToken : opts.loginScreenProps?.onMfaChallenge
        }
        onMfaSetupRequired={
          MfaSetupComponent
            ? (preauthSetupToken, accountLabel) =>
                setSetupRequest({ preauthSetupToken, accountLabel })
            : opts.loginScreenProps?.onMfaSetupRequired
        }
      />
    );
  }
  return LoginRoute;
}

export type AuthGateOptions = LoginRouteOptions & {
  /** Login page outside the SPA (root-relative path or http(s) URL). Unauthenticated
   *  visitors are sent there with `next=<current path>`; the built-in login screen
   *  is not rendered. */
  readonly loginUrl?: string;
};

export type SessionAuthGateOptions = AuthGateOptions & {
  /** Where logout navigates to (root-relative path or http(s) URL). Without it, logout reloads the page. */
  readonly postLogoutUrl?: string;
};

function redirectToLoginUrl(loginUrl: string): void {
  const { origin, pathname, search, hash, href } = window.location;
  const target = buildLoginRedirectUrl(loginUrl, `${pathname}${search}${hash}`, origin);
  // Guards a redirect loop when loginUrl points at the page we are already on.
  if (new URL(target, origin).href === href) return;
  window.location.replace(target);
}

export function makeAuthGate(opts: AuthGateOptions = {}): ComponentType<{
  children: ReactNode;
}> {
  const { loginUrl } = opts;
  if (loginUrl !== undefined) assertNavigableUrl(loginUrl, "loginUrl");
  const LoginRoute = createLoginRoute(opts);
  function AuthGate({ children }: { readonly children: ReactNode }): ReactNode {
    const { status } = useSession();
    const redirectsToLoginUrl = loginUrl !== undefined && status === "unauthenticated";
    // kumiko-lint-ignore no-raw-hooks Phase-3 conversion tracked in #2312
    useEffect(() => {
      if (redirectsToLoginUrl) redirectToLoginUrl(loginUrl);
    }, [redirectsToLoginUrl]);
    if (status === "authenticated") return <>{children}</>;
    if (redirectsToLoginUrl) return null;
    return <LoginRoute />;
  }
  return AuthGate;
}

// SessionProvider + AuthGate as one gate, so a public gate in front (e.g.
// /calculator) doesn't mount the session bootstrap — createKumikoApp stacks
// providers outside all gates, so SessionProvider can't be a provider anymore.
export function makeSessionAuthGate(opts: SessionAuthGateOptions = {}): ComponentType<{
  children: ReactNode;
}> {
  const { postLogoutUrl } = opts;
  if (postLogoutUrl !== undefined) assertNavigableUrl(postLogoutUrl, "postLogoutUrl");
  const AuthGate = makeAuthGate(opts);
  function SessionAuthGate({ children }: { readonly children: ReactNode }): ReactNode {
    return (
      <SessionProvider postLogoutUrl={postLogoutUrl}>
        <AuthGate>{children}</AuthGate>
      </SessionProvider>
    );
  }
  return SessionAuthGate;
}
