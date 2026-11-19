// Public gate for anonymous account deletion. Matches window.location.pathname:
// requestPath → RequestAccountDeletionScreen, confirmPath →
// ConfirmAccountDeletionScreen, otherwise passes through to the app. Mirrors
// makeAuthGate (auth-email-password) — userDataRightsClient adds it as a gate,
// and the app lists this client BEFORE the auth client so an anonymous visitor
// sees the deletion screen instead of the login screen. Matching during render:
// Apex transitions (the verification link) are full-page loads, not client-router
// transitions.
//
// confirmPath and cancelPath MUST match the paths of the server-side
// deletionVerifyUrl and deletionCancelUrl —
// the screens read the token from that URL.

import type { ComponentType, ReactNode } from "react";
import { CancelAccountDeletionScreen } from "./cancel-deletion-screen.tsx";
import { ConfirmAccountDeletionScreen } from "./confirm-deletion-screen.tsx";
import { RequestAccountDeletionScreen } from "./request-deletion-screen.tsx";

export type PublicDeletionRoutes = {
  /** Login-free route for the email request screen (e.g. "/account/delete"). */
  readonly requestPath: string;
  /** Login-free route for token confirmation; path of deletionVerifyUrl. */
  readonly confirmPath: string;
  /** Login-free route for the cancel-by-token screen; path of deletionCancelUrl. */
  readonly cancelPath?: string;
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
  // biome-ignore lint/correctness/noComponentHookFactories: setup-time factory, called once per userDataRightsClient(); gates only receive children, so routes are bound here
  function PublicDeletionGate({ children }: { readonly children: ReactNode }): ReactNode {
    const path = window.location.pathname;
    if (path === routes.requestPath) return shell(<RequestAccountDeletionScreen />);
    if (path === routes.confirmPath) return shell(<ConfirmAccountDeletionScreen />);
    if (routes.cancelPath !== undefined && path === routes.cancelPath) {
      return shell(<CancelAccountDeletionScreen />);
    }
    return <>{children}</>;
  }
  return PublicDeletionGate;
}
