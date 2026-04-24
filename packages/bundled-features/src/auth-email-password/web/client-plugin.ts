// Client-Feature-Factory für auth-email-password. Wird vom App-Code
// in createKumikoApp({ clientFeatures: [emailPasswordClient()] })
// eingehängt und bringt Session-Context + AuthGate mit. Der Login-
// Screen ist per Default dabei, kann aber überschrieben werden.

import type { ComponentType, ReactNode } from "react";
import { makeAuthGate } from "./auth-gate";
import type { LoginScreenProps } from "./login-screen";
import { SessionProvider } from "./session";

export type EmailPasswordClientOptions = {
  /** Eigener Login-Screen. Default: der shadcn-stylte LoginScreen
   *  aus diesem Modul. Für Branding- oder Layout-Overrides einfach
   *  eine eigene Komponente mit derselben Signatur reichen. */
  readonly loginScreen?: ComponentType<LoginScreenProps>;
  readonly loginScreenProps?: LoginScreenProps;
};

// Typed as the shape expected by createKumikoApp's clientFeatures —
// wir wollen hier aber keine harte Dep auf @kumiko/renderer-web,
// damit das Feature auch in React-Native-Renderern nutzbar bleibt,
// sobald die existieren. Der struktural identische Typ reicht.
export type EmailPasswordClientFeature = {
  readonly name: "auth-email-password";
  readonly providers: readonly ComponentType<{ children: ReactNode }>[];
  readonly gates: readonly ComponentType<{ children: ReactNode }>[];
};

export function emailPasswordClient(
  options: EmailPasswordClientOptions = {},
): EmailPasswordClientFeature {
  return {
    name: "auth-email-password",
    providers: [SessionProvider],
    gates: [makeAuthGate(options.loginScreen, options.loginScreenProps)],
  };
}
