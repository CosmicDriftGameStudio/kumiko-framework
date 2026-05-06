// Session Revocation Sample
//
// Shows the production-wiring shape: an app builds `createSessionCallbacks()`
// against a live DB handle, then hands the creator/revoker/checker to
// `buildServer({ auth: ... })`. From there the framework handles the rest —
// login persists a sid, the middleware checks it on every request, logout
// flips the DB row, a forged JWT without a matching session is rejected.
//
// What to copy into your own app:
//
//   const db = createDbConnection(config.databaseUrl);
//   const callbacks = createSessionCallbacks({ db });
//   const server = buildServer({
//     registry: buildRegistry([
//       // Pass the mass-revoker into the sessions feature to wire
//       // "password-change signs you out everywhere" — the feature registers
//       // a cross-feature entity-hook on the user entity that runs it.
//       createSessionsFeature({
//         autoRevokeOnPasswordChange: callbacks.sessionMassRevoker,
//       }),
//       // ... other features
//     ]),
//     context: { db, ... },
//     jwtSecret: config.jwtSecret,
//     auth: {
//       membershipQuery: "tenant:query:memberships",
//       loginHandler: "auth-email-password:write:login",
//       sessionCreator: callbacks.sessionCreator,
//       sessionRevoker: callbacks.sessionRevoker,
//       sessionChecker: callbacks.sessionChecker,
//     },
//   });
//
// Design rules the sample demonstrates:
//
//  1. Sessions are a feature, not built-in. An app that doesn't register
//     `createSessionsFeature()` (or doesn't wire callbacks) issues plain
//     stateless JWTs — valid until expiry, no revocation path.
//  2. Session storage is abstracted behind the three callback signatures.
//     This sample uses the default DB-backed impl; you could swap in a
//     Redis- or Memcached-backed version by wiring your own callbacks that
//     match `SessionCreator`/`SessionRevoker`/`SessionChecker`.
//  3. The `jti` claim on the JWT is the link between stateless token and
//     stateful server. The middleware never trusts the JWT alone when a
//     checker is wired — it confirms the sid is still live.

export {
  createSessionCallbacks,
  createSessionsFeature,
} from "@cosmicdrift/kumiko-bundled-features/sessions";
