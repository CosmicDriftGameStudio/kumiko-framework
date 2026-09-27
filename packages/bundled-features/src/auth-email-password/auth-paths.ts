// Convention paths for the four auth pages (relative to the app base URL).
// resolveAuthMail builds each flow's magic-link appUrl from baseUrl + these;
// the handlers append `?token=…` and mail via delivery (ctx.notify).

/** A plain path, or a function picking the path per resolved mail locale
 *  (e.g. `/en/reset-password`, `/de/reset-password`). */
export type AuthPath = string | ((locale: string) => string);

/** Pfad-Konstanten der 4 Auth-Seiten (relativ zur App-baseUrl). */
export type AuthPaths = {
  readonly resetPassword: AuthPath;
  readonly verifyEmail: AuthPath;
  readonly signupComplete: AuthPath;
  readonly inviteAccept: AuthPath;
};

/** Konventions-Pfade — alle Kumiko-Apps nutzen dieselben. Apps überschreiben
 *  nur die Ausnahme via `makeAuthPaths({ ... })`. */
export const DEFAULT_AUTH_PATHS = {
  resetPassword: "/reset-password",
  verifyEmail: "/verify-email",
  signupComplete: "/signup/complete",
  inviteAccept: "/invite/accept",
} as const satisfies AuthPaths;

export function makeAuthPaths(overrides: Partial<AuthPaths> = {}): AuthPaths {
  return { ...DEFAULT_AUTH_PATHS, ...overrides };
}
