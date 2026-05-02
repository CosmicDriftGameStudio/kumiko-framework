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

import type { ComponentType, ReactNode } from "react";
import { LoginScreen, type LoginScreenProps } from "./login-screen";
import { useSession } from "./session";

export function makeAuthGate(
  LoginComponent: ComponentType<LoginScreenProps> = LoginScreen,
  loginProps?: LoginScreenProps,
): ComponentType<{ children: ReactNode }> {
  function AuthGate({ children }: { readonly children: ReactNode }): ReactNode {
    const { status } = useSession();
    if (status === "loading") {
      return (
        <div className="min-h-screen flex items-center justify-center text-muted-foreground text-sm" />
      );
    }
    if (status === "unauthenticated") {
      return <LoginComponent {...loginProps} />;
    }
    return <>{children}</>;
  }
  return AuthGate;
}
