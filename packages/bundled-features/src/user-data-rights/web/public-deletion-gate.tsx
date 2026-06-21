// @runtime client
// Public-Gate für die anonyme Account-Löschung. Matcht window.location.pathname:
// requestPath → RequestAccountDeletionScreen, confirmPath →
// ConfirmAccountDeletionScreen, sonst durch zur App. Spiegelt makeAuthGate
// (auth-email-password) — userDataRightsClient hängt es als Gate ein, die App
// listet den Client VOR dem Auth-Client, damit ein anonymer Besucher die Lösch-
// Maske statt der Login-Maske sieht. Path-Match beim Render: Apex-Übergänge
// (der Verify-Link) sind Full-Page-Loads, kein Client-Router.
//
// confirmPath MUSS dem Pfad der server-seitigen deletionVerifyUrl entsprechen —
// der ConfirmScreen liest das ?token aus eben dieser URL.

import type { ComponentType, ReactNode } from "react";
import { ConfirmAccountDeletionScreen } from "./confirm-deletion-screen";
import { RequestAccountDeletionScreen } from "./request-deletion-screen";

export type PublicDeletionRoutes = {
  /** Login-freie Route für die Email-Antrags-Maske (z.B. "/account/delete"). */
  readonly requestPath: string;
  /** Login-freie Route für die Token-Bestätigung; = Pfad der deletionVerifyUrl. */
  readonly confirmPath: string;
  /** Chrome um die Screen-Card. Default: vollflächig zentriert (wie der Auth-
   *  defaultShell). Apps reichen ihre eigene Shell (z.B. Marketing-Header). */
  readonly shell?: (screen: ReactNode) => ReactNode;
};

const centeredShell = (screen: ReactNode): ReactNode => (
  <div className="min-h-screen flex items-center justify-center bg-background px-4">{screen}</div>
);

export function makePublicDeletionGate(
  routes: PublicDeletionRoutes,
): ComponentType<{ children: ReactNode }> {
  const shell = routes.shell ?? centeredShell;
  function PublicDeletionGate({ children }: { readonly children: ReactNode }): ReactNode {
    const path = window.location.pathname;
    if (path === routes.requestPath) return shell(<RequestAccountDeletionScreen />);
    if (path === routes.confirmPath) return shell(<ConfirmAccountDeletionScreen />);
    return <>{children}</>;
  }
  return PublicDeletionGate;
}
