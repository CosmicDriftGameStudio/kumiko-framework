import {
  prependBasePath,
  stripBasePath,
  useBasePath,
  useLocale,
} from "@cosmicdrift/kumiko-renderer";
import type { ComponentType, ReactNode } from "react";
import {
  type AuthPath,
  type AuthPaths,
  DEFAULT_FORGOT_PASSWORD_PATH,
  DEFAULT_LOGIN_PATH,
  DEFAULT_SIGNUP_PATH,
  makeAuthPaths,
} from "./auth-paths.ts";
import { ConfirmAccountUnlockScreen } from "./confirm-account-unlock-screen.tsx";
import { ForgotPasswordScreen } from "./forgot-password-screen.tsx";
import { InviteAcceptScreen } from "./invite-accept-screen.tsx";
import { RequestAccountUnlockScreen } from "./request-account-unlock-screen.tsx";
import { ResetPasswordScreen } from "./reset-password-screen.tsx";
import { SignupCompleteScreen } from "./signup-complete-screen.tsx";
import { DefaultSignupRoute } from "./signup-screen.tsx";
import { VerifyEmailScreen } from "./verify-email-screen.tsx";

export type DefaultAuthPagesOptions = {
  /** Same object as the server's auth.mail.paths; resolved through makeAuthPaths. */
  readonly paths?: Partial<AuthPaths>;
};

function hasToken(search: string): boolean {
  return (new URLSearchParams(search).get("token") ?? "") !== "";
}

function resolveAuthPath(path: AuthPath, locale: string): string {
  return typeof path === "function" ? path(locale) : path;
}

function pickDefaultAuthPage(
  pathname: string,
  search: string,
  resolvedPaths: Readonly<Record<keyof AuthPaths, string>>,
  loginHref: string,
  basePath: string,
  children: ReactNode,
): ReactNode {
  const trimmed = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  const path = stripBasePath(trimmed, basePath);
  if (path === DEFAULT_FORGOT_PASSWORD_PATH) return <ForgotPasswordScreen loginHref={loginHref} />;
  if (path === resolvedPaths.resetPassword) {
    return hasToken(search) ? <ResetPasswordScreen loginHref={loginHref} /> : null;
  }
  if (path === resolvedPaths.unlockAccount) {
    return hasToken(search) ? (
      <ConfirmAccountUnlockScreen loginHref={loginHref} />
    ) : (
      <RequestAccountUnlockScreen loginHref={loginHref} />
    );
  }
  // These screens show their own missing-token message, and they scrub ?token from the URL on
  // mount, so a token gate would hand the page to the app on the next render.
  if (path === resolvedPaths.verifyEmail) return <VerifyEmailScreen loginHref={loginHref} />;
  // No loggedInHref: the server's postAuthLanding decides where the visitor lands.
  if (path === resolvedPaths.signupComplete) return <SignupCompleteScreen loginHref={loginHref} />;
  if (path === resolvedPaths.inviteAccept) return <InviteAcceptScreen loginHref={loginHref} />;
  if (path === DEFAULT_SIGNUP_PATH) {
    return <DefaultSignupRoute loginHref={loginHref}>{children}</DefaultSignupRoute>;
  }
  return null;
}

function DefaultAuthPagesGateView({
  paths,
  children,
}: {
  readonly paths: AuthPaths;
  readonly children: ReactNode;
}): ReactNode {
  const { pathname, search } = window.location;
  const basePath = useBasePath();
  const locale = useLocale().locale();
  const resolvedPaths = {
    resetPassword: resolveAuthPath(paths.resetPassword, locale),
    verifyEmail: resolveAuthPath(paths.verifyEmail, locale),
    signupComplete: resolveAuthPath(paths.signupComplete, locale),
    inviteAccept: resolveAuthPath(paths.inviteAccept, locale),
    unlockAccount: resolveAuthPath(paths.unlockAccount, locale),
  };
  const loginHref = prependBasePath(DEFAULT_LOGIN_PATH, basePath);
  return (
    pickDefaultAuthPage(pathname, search, resolvedPaths, loginHref, basePath, children) ?? (
      <>{children}</>
    )
  );
}

// Sits inside emailPasswordClient's gate list, so app gates registered earlier
// (outer) still win on the same path. The pages are public: no session needed.
export function makeDefaultAuthPagesGate(
  options: DefaultAuthPagesOptions = {},
): ComponentType<{ readonly children: ReactNode }> {
  const paths = makeAuthPaths(options.paths);
  const gate: ComponentType<{ readonly children: ReactNode }> = ({ children }) => (
    <DefaultAuthPagesGateView paths={paths}>{children}</DefaultAuthPagesGateView>
  );
  Object.defineProperty(gate, "name", { value: "DefaultAuthPagesGate" });
  return gate;
}

export const DefaultAuthPagesGate = makeDefaultAuthPagesGate();
