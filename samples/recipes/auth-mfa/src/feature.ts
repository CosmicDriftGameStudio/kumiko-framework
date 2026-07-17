// Auth MFA (TOTP/2FA) Sample
//
// Shows the production-wiring shape: mount `createAuthMfaFeature()` next to
// `createAuthEmailPasswordFeature()`, thread its status-checker into the
// login handler, and (if `sessions` is mounted) bind its revoke-all-other-
// sessions callback. From there the framework handles the rest — login
// returns a challenge instead of a JWT when MFA is enabled, POST
// /auth/mfa/verify completes it, and every OTHER live session gets signed
// out whenever the account's MFA state changes (enable/disable/regenerate).
//
// What to copy into your own app:
//
//   const mfaFeature = createAuthMfaFeature({
//     setupTokenSecret: config.mfaSetupSecret,
//     challengeTokenSecret: config.mfaChallengeSecret,
//     issuer: "Your App",
//   });
//   const sessionCallbacks = createSessionCallbacks({ db });
//   bindMfaRevokeAllOtherSessionsFromFeature(mfaFeature)?.(
//     sessionCallbacks.sessionRevokeAllOthers,
//   );
//
//   const server = buildServer({
//     registry: buildRegistry([
//       createAuthEmailPasswordFeature({
//         mfaStatusChecker: mfaStatusCheckerFromFeature(mfaFeature),
//       }),
//       createSessionsFeature({
//         autoRevokeOnPasswordChange: sessionCallbacks.sessionMassRevoker,
//       }),
//       mfaFeature,
//       // ... other features
//     ]),
//     context: { db, ... },
//     jwtSecret: config.jwtSecret,
//     auth: {
//       membershipQuery: "tenant:query:memberships",
//       loginHandler: "auth-email-password:[REDACTED:API key param]",
//       mfaVerifyHandler: AuthMfaHandlers.verify,
//       sessionCreator: sessionCallbacks.sessionCreator,
//       sessionRevoker: sessionCallbacks.sessionRevoker,
//       sessionChecker: sessionCallbacks.sessionChecker,
//     },
//   });
//
// Apps built via runDevApp/runProdApp (the dev-server bootstrap) get all of
// this for free just by adding `createAuthMfaFeature(...)` to APP_FEATURES —
// composeFeatures threads the status-checker and the bootstrap wraps the
// session-revoke bind and the /auth/mfa/verify route automatically. This
// sample shows the raw wiring contract those helpers implement.
//
// Design rules the sample demonstrates:
//
//  1. Login becomes two-step once MFA is enabled. `POST /auth/login` returns
//     `{ mfaRequired: true, challengeToken }` instead of a JWT; the client
//     completes with `POST /auth/mfa/verify`.
//  2. Enrollment is stateless until confirmed. `enable-start` returns a
//     signed setup token (QR + recovery codes) — nothing is persisted until
//     `enable-confirm` proves the user scanned it with a valid TOTP code.
//  3. Recovery codes are single-use. Each of the 8 generated codes can
//     complete exactly one login challenge, then it's burned.
//  4. Every MFA state change signs out every OTHER live session (stolen-
//     session defense) — but never the session that made the change.
export {
  AuthMfaHandlers,
  base32Decode,
  bindMfaRevokeAllOtherSessionsFromFeature,
  createAuthMfaFeature,
  mfaStatusCheckerFromFeature,
  userMfaEntity,
} from "@cosmicdrift/kumiko-bundled-features/auth-mfa";
export { currentTotpCode } from "@cosmicdrift/kumiko-bundled-features/auth-mfa/testing";
