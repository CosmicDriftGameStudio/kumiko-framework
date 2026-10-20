import type { ReactNode } from "react";
import { DEFAULT_AUTH_PATHS, DEFAULT_FORGOT_PASSWORD_PATH } from "../auth-paths.ts";
import { ConfirmAccountUnlockScreen } from "./confirm-account-unlock-screen.tsx";
import { ForgotPasswordScreen } from "./forgot-password-screen.tsx";
import { RequestAccountUnlockScreen } from "./request-account-unlock-screen.tsx";
import { ResetPasswordScreen } from "./reset-password-screen.tsx";

function hasToken(search: string): boolean {
  return (new URLSearchParams(search).get("token") ?? "") !== "";
}

function pickDefaultAuthPage(pathname: string, search: string): ReactNode {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  switch (path) {
    case DEFAULT_FORGOT_PASSWORD_PATH:
      return <ForgotPasswordScreen />;
    case DEFAULT_AUTH_PATHS.resetPassword:
      return hasToken(search) ? <ResetPasswordScreen /> : null;
    case DEFAULT_AUTH_PATHS.unlockAccount:
      return hasToken(search) ? <ConfirmAccountUnlockScreen /> : <RequestAccountUnlockScreen />;
    default:
      return null;
  }
}

// Sits inside emailPasswordClient's gate list, so app gates registered earlier
// (outer) still win on the same path. The pages are public: no session needed.
export function DefaultAuthPagesGate({ children }: { readonly children: ReactNode }): ReactNode {
  const { pathname, search } = window.location;
  return pickDefaultAuthPage(pathname, search) ?? <>{children}</>;
}
