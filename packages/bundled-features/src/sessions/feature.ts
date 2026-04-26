import { defineFeature, type FeatureDefinition } from "@kumiko/framework/engine";
import { cleanupJob } from "./handlers/cleanup.job";
import { listQuery } from "./handlers/list.query";
import { mineQuery } from "./handlers/mine.query";
import { revokeWrite } from "./handlers/revoke.write";
import { revokeAllOthersWrite } from "./handlers/revoke-all-others.write";
import type { SessionMassRevoker } from "./session-callbacks";
import { userSessionEntity } from "./user-session-entity";

export type SessionsFeatureOptions = {
  // When wired, a successful update on the `user` entity that changes the
  // `passwordHash` column triggers a mass-revoke of every live session for
  // that user. Industry-standard "password-change signs you out everywhere"
  // flow, including the session that did the change itself — the client has
  // to re-login after a password change.
  //
  // Runs as an afterCommit postSave hook: the password-change commits first,
  // then the sessions are revoked. Best-effort — if the mass-revoker throws,
  // the password change is NOT rolled back (a password change with a stale
  // session still wins over a user-visible error on the change itself).
  readonly autoRevokeOnPasswordChange?: SessionMassRevoker;
};

// The sessions feature registers the userSession entity and the three user-
// facing handlers (mine/revoke/revoke-all-others). It intentionally does NOT
// export a sessionCreator/sessionRevoker here — those are produced by
// `createSessionCallbacks()` at app-setup time and wired into
// `buildServer({ auth: { ... } })`.
//
// Why the split: handlers participate in the dispatcher pipeline (access
// checks, audit, hooks). The creator/revoker callbacks run on the hot
// login/request path and do direct-DB writes — threading them through the
// dispatcher would buy latency without added safety (the row columns ARE
// the audit trail).
//
// Not system-scoped: sessions live per tenant, and the handlers should only
// see rows in the caller's active tenant.
export function createSessionsFeature(options?: SessionsFeatureOptions): FeatureDefinition {
  return defineFeature("sessions", (r) => {
    r.entity("user-session", userSessionEntity);

    const handlers = {
      revoke: r.writeHandler(revokeWrite),
      revokeAllOthers: r.writeHandler(revokeAllOthersWrite),
    };

    const queries = {
      mine: r.queryHandler(mineQuery),
      list: r.queryHandler(listQuery),
    };

    // Retention: chunked DELETE of expired/revoked rows. Manual trigger
    // only so dev environments don't churn. Ops wires a cron in the app's
    // dispatcher config when running a long-lived deployment.
    r.job("cleanup", { trigger: { manual: true } }, cleanupJob);

    // Cross-feature entity hook on "user". `r.entityHook` (NOT `r.hook`) is
    // the supported cross-feature path: entity-keyed, not prefixed by the
    // registering feature. Fires after every successful write on any
    // user-entity handler; we only act when passwordHash is part of the
    // changes-delta the handler was given.
    //
    // Checking `changes["passwordHash"] !== undefined` is cheaper and more
    // correct than diffing data vs previous — "undefined in changes" means
    // "the handler didn't touch this column", which is exactly the signal
    // we want to skip on. Works for both direct user:update calls and any
    // other handler that happens to write the column.
    const autoRevoke = options?.autoRevokeOnPasswordChange;
    if (autoRevoke) {
      r.entityHook("postSave", "user", async (ctx) => {
        // skip: brand-new user, no sessions can possibly exist yet. The
        // initial passwordHash on a user:create would trip the second guard
        // otherwise — every registration would do a mass-revoke roundtrip
        // for a user who literally has no rows in user_sessions.
        if (ctx.isNew) return;
        // skip: handler didn't touch passwordHash, nothing to revoke
        if (ctx.changes["passwordHash"] === undefined) return;
        await autoRevoke(String(ctx.id));
      });
    }

    return { handlers, queries };
  });
}
