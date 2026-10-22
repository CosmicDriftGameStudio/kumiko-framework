// Public gate for anonymous account deletion. Matches window.location.pathname:
// requestPath → RequestAccountDeletionScreen, confirmPath →
// ConfirmAccountDeletionScreen, otherwise passes through to the app. Mirrors
// makeAuthGate (auth-email-password) — userDataRightsClient adds it as a gate,
// and the app lists this client BEFORE the auth client so an anonymous visitor
// sees the deletion screen instead of the login screen. Matching during render:
// Apex transitions (the verification link) are full-page loads, not client-router
// transitions.
//
// confirmPath MUST match the path of the server-side deletionVerifyUrl —
// ConfirmScreen reads the ?token from that URL.

import type { ComponentType, ReactNode } from "react";
import { ConfirmAccountDeletionScreen } from "./confirm-deletion-screen.tsx";
import { RequestAccountDeletionScreen } from "./request-deletion-screen.tsx";

export type PublicDeletionRoutes = {
  /** Login-free route for the email request screen (e.g. "/account/delete"). */
  readonly requestPath: string;
  /** Login-free route for token confirmation; path of deletionVerifyUrl. */
  readonly confirmPath: string;
  /** Shell around the screen card. Default: full-screen centered (like the auth-
   *  defaultShell). Apps can provide their own shell (e.g. a marketing header). */
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
