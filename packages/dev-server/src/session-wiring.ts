/**
 * runProdApp session-wiring decision (extracted pure so it is testable without a
 * full prod boot).
 *
 * Secure-by-default: mounting the `sessions` feature turns server-side session
 * revocation + sessionStrictMode ON automatically — there is no separate opt-in. The
 * `auth.sessions` option only overrides the config, and `auth.sessions: false` is the
 * explicit opt-out (back to stateless JWTs).
 */

export type ProdSessionsConfig = { readonly expiresInMs?: number };

/** Config object to override defaults, or `false` to disable session wiring entirely. */
export type ProdSessionsOption = ProdSessionsConfig | false;

export function shouldWireProdSessions(
  hasAuth: boolean,
  sessionsFeatureMounted: boolean,
  sessionsOption: ProdSessionsOption | undefined,
): boolean {
  return hasAuth && sessionsFeatureMounted && sessionsOption !== false;
}

/** The config passed to buildProdSessionAuth — `false`/absent collapse to defaults. */
export function resolveProdSessionsConfig(
  sessionsOption: ProdSessionsOption | undefined,
): ProdSessionsConfig {
  return sessionsOption || {};
}
