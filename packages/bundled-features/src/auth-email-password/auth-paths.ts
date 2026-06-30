// Convention paths for the four auth pages (relative to the app base URL).
// resolveAuthMail builds each flow's magic-link appUrl from baseUrl + these;
// the handlers append `?token=…` and mail via delivery (ctx.notify).

/** Pfad-Konstanten der 4 Auth-Seiten (relativ zur App-baseUrl). */
export type AuthPaths = {
  readonly resetPassword: string;
  readonly verifyEmail: string;
  readonly signupComplete: string;
  readonly inviteAccept: string;
};

/** Konventions-Pfade — alle Kumiko-Apps nutzen dieselben. Apps überschreiben
 *  nur die Ausnahme via `makeAuthPaths({ ... })`. */
export const DEFAULT_AUTH_PATHS: AuthPaths = {
  resetPassword: "/reset-password",
  verifyEmail: "/verify-email",
  signupComplete: "/signup/complete",
  inviteAccept: "/invite/accept",
};

export function makeAuthPaths(overrides: Partial<AuthPaths> = {}): AuthPaths {
  return { ...DEFAULT_AUTH_PATHS, ...overrides };
}
