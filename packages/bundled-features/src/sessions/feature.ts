import { buildEntityTableMeta } from "@cosmicdrift/kumiko-framework/db";
import { defineFeature, type FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";
import { cleanupJob } from "./handlers/cleanup.job";
import { listQuery } from "./handlers/list.query";
import { mineQuery } from "./handlers/mine.query";
import { revokeWrite } from "./handlers/revoke.write";
import { revokeAllForUserWrite } from "./handlers/revoke-all-for-user.write";
import { revokeAllOthersWrite } from "./handlers/revoke-all-others.write";
import { userSessionEntity } from "./schema/user-session";
import type { SessionMassRevoker } from "./session-callbacks";

export type SessionsFeatureOptions = {
  // A successful update on the `user` entity that changes the `passwordHash`
  // column triggers a mass-revoke of every live session for that user.
  // Industry-standard "password-change signs you out everywhere" flow,
  // including the session that did the change itself — the client has
  // to re-login after a password change.
  //
  // Runs as an afterCommit postSave hook: the password-change commits first,
  // then the sessions are revoked. Best-effort — if the mass-revoker throws,
  // the password change is NOT rolled back (a password change with a stale
  // session still wins over a user-visible error on the change itself).
  //
  // Default: run{Prod,Dev}App bind their own sessionMassRevoker via
  // `bindAutoRevokeOnPasswordChange` (secure-by-default). Set this option
  // only to supply a custom revoker — an explicit value wins over the
  // runtime binding.
  readonly autoRevokeOnPasswordChange?: SessionMassRevoker;
};

export type BindAutoRevokeOnPasswordChange = (revoker: SessionMassRevoker) => void;

// Reads the late-bind setter off a mounted sessions feature's exports.
// run{Prod,Dev}App call it once the DB connection is concrete — the feature
// itself is constructed in app run-config long before a db exists, so the
// revoker can't be a constructor argument.
export function bindAutoRevokeFromFeature(
  feature: FeatureDefinition,
): BindAutoRevokeOnPasswordChange | undefined {
  const exports = feature.exports;
  if (exports && typeof exports === "object" && "bindAutoRevokeOnPasswordChange" in exports) {
    const { bindAutoRevokeOnPasswordChange } = exports as {
      bindAutoRevokeOnPasswordChange: unknown;
    };
    if (typeof bindAutoRevokeOnPasswordChange === "function") {
      // @cast-boundary exports-walk — feature.exports is untyped by design
      return bindAutoRevokeOnPasswordChange as BindAutoRevokeOnPasswordChange;
    }
  }
  return undefined;
}

// The sessions feature registers the read_user_sessions table (as an
// unmanaged direct-write store, NOT an r.entity — see below) and the three
// user-facing handlers (mine/revoke/revoke-all-others). It intentionally does NOT
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
    r.describe(
      "Tracks signed-in clients in the `read_user_sessions` table (one row per JWT, keyed by the `sid`/`jti` claim) and exposes handlers for `mine` (list your sessions), `revoke`, and `revokeAllOthers`. Session creation and revocation on the hot auth path are handled by `createSessionCallbacks()`, wired into `buildServer({ auth: { ... } })` outside the dispatcher; the feature also ships a manual-trigger cleanup job for pruning expired rows and an optional `autoRevokeOnPasswordChange` hook that mass-revokes all sessions for a user whenever their `passwordHash` changes.",
    );
    r.uiHints({
      displayLabel: "Sessions · Server-side Logout",
      category: "identity",
      recommended: false,
    });
    // sessionChecker reads read_users on every authenticated request (status
    // gate for locked accounts) — make that a boot-time dependency so a
    // sessions-without-user wiring fails validateBoot instead of 500ing live.
    r.requires("user");
    // read_user_sessions is a hot-path direct-write store: sessionCreator
    // inserts and the revoke handlers update rows WITHOUT emitting lifecycle
    // events (the row columns ARE the audit trail). Registering it as
    // r.entity would make it a rebuildable implicit projection whose replay
    // finds zero session events and swaps an empty shadow over the live
    // table — wiping every active session on the next projection rebuild
    // (#498/#494). r.unmanagedTable keeps the migration DDL but opts the
    // table out of implicit rebuild, like jobs/channel-in-app/feature-toggles
    // which are direct-write stores too.
    r.unmanagedTable(buildEntityTableMeta("user-session", userSessionEntity), {
      reason: "read_side.user_sessions_direct_write",
      // sessionCreator encrypts ip/userAgent via encryptForDirectWrite (#820).
      piiEncryptedOnWrite: true,
    });

    const handlers = {
      revoke: r.writeHandler(revokeWrite),
      revokeAllOthers: r.writeHandler(revokeAllOthersWrite),
      revokeAllForUser: r.writeHandler(revokeAllForUserWrite),
    };
    r.exposesApi("sessions.revokeAllForUser");

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
    let autoRevoke = options?.autoRevokeOnPasswordChange;
    r.entityHook("postSave", "user", async (ctx) => {
      // skip: nothing bound — stateless-JWT deployments without a runtime
      // that calls bindAutoRevokeOnPasswordChange keep the old behavior.
      if (!autoRevoke) return;
      // skip: brand-new user, no sessions can possibly exist yet. The
      // initial passwordHash on a user:create would trip the second guard
      // otherwise — every registration would do a mass-revoke roundtrip
      // for a user who literally has no rows in user_sessions.
      if (ctx.isNew) return;
      // skip: handler didn't touch passwordHash, nothing to revoke
      if (ctx.changes["passwordHash"] === undefined) return;
      await autoRevoke(String(ctx.id));
    });

    const bindAutoRevokeOnPasswordChange: BindAutoRevokeOnPasswordChange = (revoker) => {
      // explicit constructor option wins over the runtime binding
      autoRevoke ??= revoker;
    };

    return { handlers, queries, bindAutoRevokeOnPasswordChange };
  });
}
