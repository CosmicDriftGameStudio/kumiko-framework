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
import { LoginScreen, type LoginScreenProps } from "./login-screen";
import { SessionProvider, useSession } from "./session";

// Generic — NOT auth-mfa's MfaVerifyScreenProps directly, so this feature
// stays unaware of auth-mfa's concrete shape (same coupling direction as
// login.write.ts's mfaStatusChecker callback on the server side). Apps
// wire auth-mfa's MfaVerifyScreen in here via EmailPasswordClientOptions.
export type MfaVerifyComponentProps = {
  readonly challengeToken: string;
  readonly onSuccess?: () => void;
  readonly onCancel?: () => void;
};

export type LoginRouteOptions = {
  readonly loginScreen?: ComponentType<LoginScreenProps>;
  readonly loginScreenProps?: LoginScreenProps;
  readonly mfaVerifyScreen?: ComponentType<MfaVerifyComponentProps>;
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
// step went missing in a real apex surface; this makes that mistake
// structurally unavailable — there is no lower-level piece left to misuse.
export function createLoginRoute(
  opts: LoginRouteOptions = {},
): ComponentType<Record<string, never>> {
  const LoginComponent = opts.loginScreen ?? LoginScreen;
  const MfaVerifyComponent = opts.mfaVerifyScreen;

  function LoginRoute(): ReactNode {
    const { status } = useSession();
    // Pending challenge-token from LoginScreen's onMfaChallenge. Lives here
    // (not in SessionState) because it's a UI-only transition — the server
    // never considers this session authenticated until verify succeeds.
    const [challengeToken, setChallengeToken] = useState<string | null>(null);

    useEffect(() => {
      if (status === "authenticated") opts.onAuthenticated?.();
    }, [status]);

    if (status === "loading") {
      return (
        <div className="min-h-screen flex items-center justify-center text-muted-foreground text-sm" />
      );
    }
    if (status === "authenticated") return null;
    if (challengeToken !== null && MfaVerifyComponent) {
      return (
        <MfaVerifyComponent
          challengeToken={challengeToken}
          onSuccess={() => setChallengeToken(null)}
          onCancel={() => setChallengeToken(null)}
        />
      );
    }
    return (
      <LoginComponent
        {...opts.loginScreenProps}
        onMfaChallenge={
          MfaVerifyComponent ? setChallengeToken : opts.loginScreenProps?.onMfaChallenge
        }
      />
    );
  }
  return LoginRoute;
}

export function makeAuthGate(
  LoginComponent: ComponentType<LoginScreenProps> = LoginScreen,
  loginProps?: LoginScreenProps,
  MfaVerifyComponent?: ComponentType<MfaVerifyComponentProps>,
): ComponentType<{ children: ReactNode }> {
  const LoginRoute = createLoginRoute({
    loginScreen: LoginComponent,
    loginScreenProps: loginProps,
    mfaVerifyScreen: MfaVerifyComponent,
  });
  function AuthGate({ children }: { readonly children: ReactNode }): ReactNode {
    const { status } = useSession();
    if (status === "authenticated") return <>{children}</>;
    return <LoginRoute />;
  }
  return AuthGate;
}

// SessionProvider + AuthGate as one gate, so a public gate in front (e.g.
// /calculator) doesn't mount the session bootstrap — createKumikoApp stacks
// providers outside all gates, so SessionProvider can't be a provider anymore.
export function makeSessionAuthGate(
  LoginComponent: ComponentType<LoginScreenProps> = LoginScreen,
  loginProps?: LoginScreenProps,
  MfaVerifyComponent?: ComponentType<MfaVerifyComponentProps>,
): ComponentType<{ children: ReactNode }> {
  const AuthGate = makeAuthGate(LoginComponent, loginProps, MfaVerifyComponent);
  function SessionAuthGate({ children }: { readonly children: ReactNode }): ReactNode {
    return (
      <SessionProvider>
        <AuthGate>{children}</AuthGate>
      </SessionProvider>
    );
  }
  return SessionAuthGate;
}
