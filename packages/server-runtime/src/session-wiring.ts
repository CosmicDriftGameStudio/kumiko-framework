/**
 * runProdApp session-wiring decision (extracted pure so it is testable without a
 * full prod boot).
 *
 * Secure-by-default (#1372): mounting a sessionStore provider (sessions feature)
 * turns server-side session revocation ON automatically. There is no
 * `auth.sessions` opt-in/opt-out — mount sessions for revocable JWTs, omit it
 * for intentional stateless JWTs (boot-gate warns / aborts unless acknowledged
 * via a future flag if needed; today auth without sessions fails the gate).
 */

export function shouldWireProdSessions(
  hasAuth: boolean,
  sessionStoreProviderMounted: boolean,
): boolean {
  return hasAuth && sessionStoreProviderMounted;
}
