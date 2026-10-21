// Auth gate: renders the LoginScreen while the session status is
// "unauthenticated" and the children otherwise. "loading" shows a
// minimal placeholder—the initial refresh usually completes in <100ms,
// so a spinner would be excessive.
//
// The makeAuthGate factory closes over the LoginScreen component so the
// gate matches the ClientFeatureDefinition signature (only a `{ children }`
// prop). This lets the sample configure a custom login screen without
// replacing the gate.

import { useLocale } from "@cosmicdrift/kumiko-renderer";
import { type ComponentType, type ReactNode, useEffect, useMemo, useState } from "react";
import {
  assertNavigableUrl,
  buildLoginRedirectUrl,
  followNextOrLandingAfterLogin,
} from "./auth-redirect.ts";
import { LoginScreen, type LoginScreenProps } from "./login-screen.tsx";
import { SessionProvider, useSession } from "./session.tsx";
import { SessionBootstrapErrorScreen } from "./session-bootstrap-error.tsx";

// Generic — NOT auth-mfa's MfaVerifyScreenProps directly, so this feature
// stays unaware of auth-mfa's concrete shape (same coupling direction as
// login.write.ts's mfaStatusChecker callback on the server side). Apps
// wire auth-mfa's MfaVerifyScreen in here via EmailPasswordClientOptions.
export type MfaVerifyComponentProps = {
  readonly challengeToken: string;
  readonly onSuccess?: (landingPath?: string) => void;
  readonly onCancel?: () => void;
};

// Same coupling reasoning as MfaVerifyComponentProps above — generic, not
// auth-mfa's MfaSetupPreauthScreenProps directly. Apps wire auth-mfa's
// MfaSetupPreauthScreen in here via EmailPasswordClientOptions.
export type MfaSetupComponentProps = {
  readonly preauthSetupToken: string;
  readonly accountLabel: string;
  readonly onSuccess?: (landingPath?: string) => void;
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
// token swap itself is exactly how the login-time MFA step went missing in a
// real apex surface; this prevents the *most common* version of that mistake.
// MFA still only actually works once a consumer wires `mfaVerifyScreen` —
// omitting it is a silent no-MFA fallback, not something this route can catch
// on its own (auth-mfa is a separate, optional package).
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

    // kumiko-lint-ignore no-raw-hooks
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
          onSuccess={(landingPath) => {
            setChallengeToken(null);
            followNextOrLandingAfterLogin(landingPath);
          }}
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
          onSuccess={(landingPath) => {
            // MfaSetupPreauthScreen has no session to refresh itself with
            // (it runs pre-auth) — the gate owns the session, so it refreshes.
            // refresh() never rejects: a failed refresh surfaces as status
            // "error" (bootstrap error screen with retry), so only the
            // success path needs to clear setupRequest.
            void refresh().then(() => {
              setSetupRequest(null);
              followNextOrLandingAfterLogin(landingPath);
            });
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

/** Builds the login page URL. `returnPath` is the current path + query + hash;
 *  append it as `next` yourself (use `NEXT_QUERY_PARAM`) if the login page should return there. */
export type LoginUrlBuilder = (locale: string, returnPath: string) => string;

export type AuthGateOptions = LoginRouteOptions & {
  /** Login page outside the SPA (root-relative path or http(s) URL), or a function
   *  that builds it per locale. Unauthenticated visitors are sent there with
   *  `next=<current path>` (a string gets `next` appended; a function decides itself).
   *  On the login route itself the gate renders the built-in login screen instead. */
  readonly loginUrl?: string | LoginUrlBuilder;
};

export type SessionAuthGateOptions = AuthGateOptions & {
  /** Where logout navigates to (root-relative path or http(s) URL). Without it, logout reloads the page. */
  readonly postLogoutUrl?: string;
};

type LoginRedirect =
  | { readonly kind: "on-login-route" }
  | { readonly kind: "redirect"; readonly url: string };

// @internal — exported for unit tests only.
export function resolveLoginRedirect(
  loginUrl: string | LoginUrlBuilder,
  locale: string,
  { origin, pathname, search, hash }: Pick<Location, "origin" | "pathname" | "search" | "hash">,
): LoginRedirect {
  const returnPath = `${pathname}${search}${hash}`;
  const target = typeof loginUrl === "function" ? loginUrl(locale, returnPath) : loginUrl;
  if (typeof loginUrl === "function") assertNavigableUrl(target, "loginUrl()");
  // Compared before `next` is appended: the target always differs from the current
  // URL once it carries next, so a gate mounted on the login page itself would loop.
  const loginLocation = new URL(target, origin);
  if (loginLocation.origin === origin && loginLocation.pathname === pathname) {
    return { kind: "on-login-route" };
  }
  return {
    kind: "redirect",
    url:
      typeof loginUrl === "function" ? target : buildLoginRedirectUrl(target, returnPath, origin),
  };
}

// A throwing loginUrl builder must not take the whole app tree down in render;
// null falls through to the built-in login screen.
function resolveLoginRedirectOrNull(
  loginUrl: string | LoginUrlBuilder,
  locale: string,
  location: Pick<Location, "origin" | "pathname" | "search" | "hash">,
): LoginRedirect | null {
  try {
    return resolveLoginRedirect(loginUrl, locale, location);
  } catch (error) {
    console.error("Auth gate: loginUrl could not be resolved, showing the built-in login", error);
    return null;
  }
}

export function makeAuthGate(opts: AuthGateOptions = {}): ComponentType<{
  children: ReactNode;
}> {
  const { loginUrl } = opts;
  if (typeof loginUrl === "string") assertNavigableUrl(loginUrl, "loginUrl");
  const LoginRoute = createLoginRoute(opts);
  function AuthGate({ children }: { readonly children: ReactNode }): ReactNode {
    const { status } = useSession();
    const locale = useLocale().locale();
    const { origin, pathname, search, hash } = window.location;
    const loginRedirect = useMemo(
      () =>
        loginUrl !== undefined && status === "unauthenticated"
          ? resolveLoginRedirectOrNull(loginUrl, locale, { origin, pathname, search, hash })
          : null,
      [status, locale, origin, pathname, search, hash],
    );
    const redirectUrl = loginRedirect?.kind === "redirect" ? loginRedirect.url : null;
    // kumiko-lint-ignore no-raw-hooks
    useEffect(() => {
      if (redirectUrl !== null) window.location.replace(redirectUrl);
    }, [redirectUrl]);
    if (status === "authenticated") return <>{children}</>;
    if (redirectUrl !== null) return null;
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
