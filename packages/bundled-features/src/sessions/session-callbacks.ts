import type {
  AuthSessionStatus,
  SessionChecker,
  SessionCreator,
  SessionMetadata,
  SessionRevoker,
} from "@cosmicdrift/kumiko-framework/api";
import { fetchOne, insertOne, updateMany } from "@cosmicdrift/kumiko-framework/bun-db";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import type { SessionUser } from "@cosmicdrift/kumiko-framework/engine";
import { generateId } from "@cosmicdrift/kumiko-framework/utils";
import { Temporal } from "temporal-polyfill";
import { USER_STATUS, userTable } from "../user";
import { DEFAULT_SESSION_EXPIRY_MS } from "./constants";
import { userSessionTable } from "./schema/user-session";

// Locked accounts whose live sessions must be refused. deletionRequested is
// intentionally absent — it's a reversible grace period and the user needs
// their session to reach cancel-deletion.
const BLOCKED_STATUSES: ReadonlySet<string> = new Set([
  USER_STATUS.Restricted,
  USER_STATUS.Deleted,
]);

// Why the callbacks live at the raw-DB level rather than going through the
// dispatcher: session-create/revoke/check run on the hot path of every
// login and every request. The (createdAt/revokedAt/ip/userAgent) columns
// already are the audit trail — a dispatcher roundtrip buys nothing.

// Mass-revoke for a single user. Used by the password-change hook and
// "sign out everywhere" flows. Returns the count of rows flipped so a
// caller can log "revoked N other sessions".
export type SessionMassRevoker = (userId: string) => Promise<number>;

export type SessionCallbacksOptions = {
  readonly db: DbConnection;
  // Session lifetime. MVP uses a single flat window; per-app policies can
  // come later (e.g. longer for "remember me", shorter for admin).
  readonly expiresInMs?: number;
};

export type SessionCallbacks = {
  sessionCreator: SessionCreator;
  sessionRevoker: SessionRevoker;
  sessionChecker: SessionChecker;
  sessionMassRevoker: SessionMassRevoker;
};

export function createSessionCallbacks(opts: SessionCallbacksOptions): SessionCallbacks {
  const ttlMs = opts.expiresInMs ?? DEFAULT_SESSION_EXPIRY_MS;
  const { db } = opts;

  return {
    async sessionCreator(user: SessionUser, meta: SessionMetadata): Promise<string> {
      const sid = generateId();
      const now = Temporal.Now.instant();
      const expiresAt = now.add({ milliseconds: ttlMs });
      await insertOne(db, userSessionTable, {
        id: sid,
        tenantId: user.tenantId,
        userId: user.id,
        createdAt: now,
        expiresAt,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      return sid;
    },

    async sessionRevoker(sid: string): Promise<void> {
      // Audit-preserving: `isNull(revokedAt)` in WHERE means a second call
      // on an already-revoked sid is a no-op instead of overwriting the
      // original timestamp. Double-revoke races land here via logout +
      // switch-tenant on the same sid. (Password-change uses a different
      // callback — sessionMassRevoker — and isn't in scope for this guard.)
      await updateMany(
        db,
        userSessionTable,
        { revokedAt: Temporal.Now.instant() },
        { id: sid, revokedAt: null },
      );
    },

    async sessionChecker(sid: string, expectedUserId: string): Promise<AuthSessionStatus> {
      const row = await fetchOne<{
        userId: string;
        revokedAt: unknown;
        expiresAt: { epochMilliseconds: number };
      }>(db, userSessionTable, { id: sid });
      if (!row) return "missing";
      // Cross-user check: if the sid belongs to someone else, treat it
      // identically to "missing" so a compromised sid paired with a valid
      // JWT from a different user gets the same opaque response as a
      // forged sid. No existence oracle on other users' sids.
      if (row.userId !== expectedUserId) return "missing";
      if (row.revokedAt !== null) return "revoked";
      // Temporal-native clock read (Sprint F migration) — keeps the feature
      // free of raw Date.now() for consistency with the rest of the codebase.
      if (row.expiresAt.epochMilliseconds <= Temporal.Now.instant().epochMilliseconds) {
        return "expired";
      }
      // Defense-in-depth: status flips (Art. 18 restrict, forget) revoke
      // sessions, but a missed revoke must not keep a locked account alive on
      // a stale sid. Fail-OPEN on a lookup miss — this is the second layer,
      // revocation is primary; never turn a user-row miss into a global
      // lockout. (+1 PK read on read_users per authenticated request.)
      //
      // Fail-open covers a THROW too, not just a null-miss: this read sits on
      // the hot path of every authenticated request, so a DB timeout / lock
      // contention / pool exhaustion here must not turn into a global lockout.
      const user = await fetchOne<{ status: string }>(db, userTable, { id: expectedUserId }).catch(
        () => null,
      );
      if (user && BLOCKED_STATUSES.has(user.status)) return "blocked";
      return "live";
    },

    async sessionMassRevoker(userId: string): Promise<number> {
      // Count is accurate because we only touch live rows — a previously
      // revoked row stays in its state and isn't double-counted.
      const result = await updateMany(
        db,
        userSessionTable,
        { revokedAt: Temporal.Now.instant() },
        { userId, revokedAt: null },
      );
      return result.length;
    },
  };
}
