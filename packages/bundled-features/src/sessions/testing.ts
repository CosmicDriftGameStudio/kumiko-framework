// Testing helpers for the sessions feature. The factory below turns a
// `LateBoundHolder<SessionCallbacks>` into the two shapes a test needs:
//
//   const holder = createLateBoundHolder<SessionCallbacks>("session-callbacks");
//   const bound = sessionCallbacksFromLateBound(holder);
//
//   stack = await setupTestStack({
//     features: [..., createSessionsFeature({
//       autoRevokeOnPasswordChange: bound.asMassRevoker(),
//     })],
//     authConfig: { ...bound.asAuthConfig(), membershipQuery, loginHandler },
//   });
//   holder.set(createSessionCallbacks({ db: stack.db }));
//
// Why the helper lives in bundled-features/sessions rather than framework/testing:
// it closes over `AuthRoutesConfig` + `SessionCallbacks`, both of which the
// sessions feature owns. framework/testing only provides the generic
// `createLateBoundHolder<T>` — shape-independent.

import type { AuthRoutesConfig, SessionCreator } from "@cosmicdrift/kumiko-framework/api";
import type { SessionUser } from "@cosmicdrift/kumiko-framework/engine";
import type { LateBoundHolder } from "@cosmicdrift/kumiko-framework/testing";
import type { SessionCallbacks, SessionMassRevoker } from "./session-callbacks";

export type BoundSessionCallbacks = {
  /** auth-config fragment: creator + revoker + checker, all late-bound. */
  asAuthConfig(): Pick<AuthRoutesConfig, "sessionCreator" | "sessionRevoker" | "sessionChecker">;
  /** mass-revoker function for sessionsFeature({ autoRevokeOnPasswordChange }). */
  asMassRevoker(): SessionMassRevoker;
};

export function sessionCallbacksFromLateBound(
  holder: LateBoundHolder<SessionCallbacks>,
): BoundSessionCallbacks {
  return {
    asAuthConfig: () => ({
      sessionCreator: (user, meta) => holder.get().sessionCreator(user, meta),
      sessionRevoker: (sid) => holder.get().sessionRevoker(sid),
      sessionChecker: (sid, userId) => holder.get().sessionChecker(sid, userId),
    }),
    asMassRevoker: () => (userId) => holder.get().sessionMassRevoker(userId),
  };
}

// Bootstrap actors (system-admin seed writes) need a real sid once a
// sessionChecker is wired — auth-middleware rejects sidless JWTs as
// forged/pre-session-tracking. Mints a live session row and returns the
// actor with `sid` attached so `stack.http.writeOk(..., actor)` passes.
export async function withMintedSession(
  sessionCreator: SessionCreator,
  user: SessionUser,
): Promise<SessionUser> {
  const sid = await sessionCreator(user, { ip: "127.0.0.1", userAgent: "test" });
  return { ...user, sid };
}
