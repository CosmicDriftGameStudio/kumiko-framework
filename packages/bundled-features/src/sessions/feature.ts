import {
  type CredentialRevoker,
  EXT_CREDENTIAL_REVOKER,
  EXT_SESSION_STORE,
  type SessionStore,
  type SessionStoreProvider,
} from "@cosmicdrift/kumiko-bundled-features/auth-foundation";
import { deriveEntityTableMeta } from "@cosmicdrift/kumiko-framework/db";
import {
  type AdminNavArea,
  access,
  defineFeature,
  type FeatureDefinition,
} from "@cosmicdrift/kumiko-framework/engine";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import type { Clock } from "@cosmicdrift/kumiko-types/tz-context";
import { cleanupJob } from "./handlers/cleanup.job.ts";
import { createDetailQuery } from "./handlers/detail.query.ts";
import {
  readProbeSecretFromEnv,
  registerLastActivityProbe,
} from "./handlers/last-activity-probe.route.ts";
import { createListQuery } from "./handlers/list.query.ts";
import { mineQuery } from "./handlers/mine.query.ts";
import { revokeWrite } from "./handlers/revoke.write.ts";
import { revokeAllForUserWrite } from "./handlers/revoke-all-for-user.write.ts";
import { revokeAllOthersWrite } from "./handlers/revoke-all-others.write.ts";
import { revokeSessionsAndAnnounce } from "./revoke-sessions.ts";
import { userSessionEntity } from "./schema/user-session.ts";
import {
  createSessionDetailScreen,
  createSessionListScreen,
  sessionMineScreen,
} from "./screens.ts";
import { createSessionCallbacks } from "./session-callbacks.ts";
import { SESSION_REVOKED_EVENT_SHORT, sessionRevokedSchema } from "./session-revoked-event.ts";
import { SESSIONS_I18N } from "./web/i18n.ts";

const CLEANUP_ESCAPE_HATCH_REASON = "deletes expired session rows of every tenant";

export type SessionsFeatureOptions = {
  // Session JWT / store_user_sessions TTL. Was previously auth.sessions.expiresInMs
  // — lives on the sessions feature now that sessionStore is the wiring.
  readonly expiresInMs?: number;
  // Access preset for the admin list/detail queries and screens; they expose decrypted
  // IP/user-agent of every session in the tenant. A preset name, not a role array, because
  // dedupeOptions must stay primitive.
  readonly adminAccess?: "admin" | "systemAdmin";
  // Admin area of the session-list nav; unset leaves it to the app's workspace lists.
  readonly adminArea?: AdminNavArea;
  // Real time unless a test injects a manual clock; makes session times deterministic.
  readonly clock?: Clock;
  // Opt-in: serves GET /sessions/last-activity to a sibling app presenting this secret as a
  // Bearer token. Answers the newest session activity across every tenant of this app.
  // Unset: falls back to the SESSIONS_LAST_ACTIVITY_PROBE_SECRET env (min. 32 characters).
  readonly lastActivityProbeSecret?: string;
};

// The sessions feature registers the store_user_sessions table (as an
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
  const sessionListAdminArea = options?.adminArea;
  return defineFeature(
    "sessions",
    (r) => {
      const adminRoles = access[options?.adminAccess ?? "admin"];
      r.describe(
        "Tracks signed-in clients in the `store_user_sessions` table (one row per JWT, keyed by the `sid`/`jti` claim) and exposes handlers for `mine` (list your sessions), `revoke`, and `revokeAllOthers`. Session creation and revocation on the hot auth path are handled by `createSessionCallbacks()`, wired into `buildServer({ auth: { ... } })` outside the dispatcher; the same callbacks are also registered as an auth-foundation sessionStore provider, resolvable generically via `resolveSessionStore()`. The feature also ships a daily maintenance-window cleanup job that prunes expired and revoked rows, and registers as an auth-foundation credentialRevoker, so a password change or MFA state change revokes the user's sessions in the same transaction.",
      );
      r.uiHints({
        displayLabel: "Sessions · Server-side Logout",
        category: "identity",
        recommended: false,
      });
      // sessionChecker reads read_users on every authenticated request (status
      // gate for locked accounts) — make that a boot-time dependency so a
      // sessions-without-user wiring fails validateBoot instead of 500ing live.
      // auth-foundation owns EXT_SESSION_STORE, which the useExtension below
      // registers against.
      r.requires({ features: ["user", "auth-foundation"] });
      // store_user_sessions is a hot-path direct-write store: sessionCreator
      // inserts and the revoke handlers update rows WITHOUT emitting lifecycle
      // events (the row columns ARE the audit trail). Registering it as
      // r.entity would make it a rebuildable implicit projection whose replay
      // finds zero session events and swaps an empty shadow over the live
      // table — wiping every active session on the next projection rebuild.
      // r.storeTable keeps the migration DDL but opts the
      // table out of implicit rebuild, like jobs/channel-in-app/feature-toggles
      // which are direct-write stores too.
      r.storeTable(deriveEntityTableMeta(userSessionEntity, { source: "unmanaged" }), {
        reason: "read_side.user_sessions_direct_write",
        // sessionCreator encrypts ip/userAgent via encryptForDirectWrite.
        piiEncryptedOnWrite: true,
      });

      // Self-registers as auth-foundation's sessionStore provider —
      // wraps the same createSessionCallbacks() used by the manual
      // buildServer({ auth: { ... } }) wiring above; removes that manual
      // wiring once the middleware resolves generically
      // via resolveSessionStore().
      r.applyExtension({
        name: EXT_SESSION_STORE,
        entity: "default",
        ...({
          build: (deps): SessionStore => {
            const callbacks = createSessionCallbacks({
              db: deps.db,
              ...(options?.expiresInMs !== undefined && { expiresInMs: options.expiresInMs }),
              ...(options?.clock !== undefined && { clock: options.clock }),
            });
            return {
              creator: callbacks.sessionCreator,
              revoker: callbacks.sessionRevoker,
              checker: callbacks.sessionChecker,
            };
          },
        } satisfies SessionStoreProvider),
      });

      r.applyExtension({
        name: EXT_CREDENTIAL_REVOKER,
        entity: "sessions",
        ...({
          revokeAllForUser: async (runner, userId, { keepSessionId }) =>
            (
              await revokeSessionsAndAnnounce(runner, {
                where:
                  keepSessionId !== undefined ? { userId, id: { ne: keepSessionId } } : { userId },
                revokedAt: options?.clock?.now() ?? Temporal.Now.instant(),
                ...(keepSessionId !== undefined && { keptSessionId: keepSessionId }),
              })
            ).length,
        } satisfies CredentialRevoker),
      });

      // Custom domain-event for cross-instance access-invalidation.
      // r.defineEvent registers the schema so ctx.events.unsafeAppend (revoke,
      // revoke-all-others) enforces it at append time. revoke-all-for-user
      // appends via the low-level append() instead (needs to anchor on
      // SYSTEM_TENANT_ID — see that handler for why) — append() does NOT
      // consult the registry, so that callsite parses against
      // sessionRevokedSchema explicitly, same guarantee via a different path.
      // No projection: the payload IS the read, consumed directly off the
      // event-store NOTIFY.
      r.defineEvent(SESSION_REVOKED_EVENT_SHORT, sessionRevokedSchema, { piiFields: "none" });

      const handlers = {
        revoke: r.writeHandler(revokeWrite),
        revokeAllOthers: r.writeHandler(revokeAllOthersWrite),
        revokeAllForUser: r.writeHandler(revokeAllForUserWrite),
      };
      r.exposesApi("sessions.revokeAllForUser");

      const queries = {
        mine: r.queryHandler(mineQuery),
        list: r.queryHandler(createListQuery(adminRoles)),
        detail: r.queryHandler(createDetailQuery(adminRoles)),
      };

      // Retention: chunked DELETE of rows expired or revoked more than 30 days ago, once a day in the
      // maintenance window, so store_user_sessions and its ip/userAgent stay bounded without app wiring.
      r.job({
        name: "cleanup",
        trigger: { maintenance: true },
        concurrency: "skip",
        escapeHatch: { reason: CLEANUP_ESCAPE_HATCH_REASON, grants: ["unsafeRaw"] },
        handler: (payload, ctx) => cleanupJob(payload, ctx, ctx.db.unsafeRawAllTenants()),
      });

      const probeSecret = options?.lastActivityProbeSecret ?? readProbeSecretFromEnv();
      if (probeSecret !== undefined) registerLastActivityProbe(r, probeSecret);

      r.translations({ keys: SESSIONS_I18N });

      r.screen(createSessionListScreen(adminRoles));
      r.screen(createSessionDetailScreen(adminRoles));
      r.screen(sessionMineScreen);
      r.nav({
        id: "session-list",
        label: "sessions:nav.sessionList",
        icon: "list",
        screen: "sessions:screen:session-list",
        order: 10,
        adminArea: sessionListAdminArea,
      });

      return { handlers, queries };
    },
    // A clock object is not a comparable dedupe option; a stack that injects one never dedupes.
    options?.clock === undefined ? { dedupeOptions: options ?? {} } : undefined,
  );
}
