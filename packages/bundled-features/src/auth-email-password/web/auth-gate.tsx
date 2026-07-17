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

import { type ComponentType, type ReactNode, useState } from "react";
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

export function makeAuthGate(
  LoginComponent: ComponentType<LoginScreenProps> = LoginScreen,
  loginProps?: LoginScreenProps,
  MfaVerifyComponent?: ComponentType<MfaVerifyComponentProps>,
): ComponentType<{ children: ReactNode }> {
  function AuthGate({ children }: { readonly children: ReactNode }): ReactNode {
    const { status } = useSession();
    // Pending challenge-token from LoginScreen's onMfaChallenge. Lives here
    // (not in SessionState) because it's a UI-only transition — the server
    // never considers this session authenticated until verify succeeds.
    const [challengeToken, setChallengeToken] = useState<string | null>(null);

    if (status === "loading") {
      return (
        <div className="min-h-screen flex items-center justify-center text-muted-foreground text-sm" />
      );
    }
    if (status === "unauthenticated") {
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
          {...loginProps}
          onMfaChallenge={MfaVerifyComponent ? setChallengeToken : loginProps?.onMfaChallenge}
        />
      );
    }
    return <>{children}</>;
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
