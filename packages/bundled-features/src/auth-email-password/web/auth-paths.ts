// Convention paths for the five auth pages (relative to the app base URL).
// resolveAuthMail builds each flow's magic-link appUrl from baseUrl + these;
// the handlers append `?token=…` and mail via delivery (ctx.notify).

/** A plain path, or a function picking the path per resolved mail locale
 *  (e.g. `/en/reset-password`, `/de/reset-password`). */
export type AuthPath = string | ((locale: string) => string);

export type AuthPaths = {
  readonly resetPassword: AuthPath;
  readonly verifyEmail: AuthPath;
  readonly signupComplete: AuthPath;
  readonly inviteAccept: AuthPath;
  readonly unlockAccount: AuthPath;
};

/** Shared by every Kumiko app; apps override only the exceptions via `makeAuthPaths({ ... })`. */
export const DEFAULT_AUTH_PATHS = {
  resetPassword: "/reset-password",
  verifyEmail: "/verify-email",
  signupComplete: "/signup/complete",
  inviteAccept: "/invite/accept",
  unlockAccount: "/unlock-account",
} as const satisfies AuthPaths;

/** Client page that requests a reset mail; no mail links to it, so it is not part of AuthPaths. */
export const DEFAULT_FORGOT_PASSWORD_PATH = "/forgot-password";

export function makeAuthPaths(overrides: Partial<AuthPaths> = {}): AuthPaths {
  return { ...DEFAULT_AUTH_PATHS, ...overrides };
}
