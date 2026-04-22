import type {
  AuthSessionStatus,
  SessionChecker,
  SessionCreator,
  SessionMetadata,
  SessionRevoker,
} from "@kumiko/framework/api";
import type { DbConnection } from "@kumiko/framework/db";
import type { SessionUser } from "@kumiko/framework/engine";
import { and, eq, isNull } from "drizzle-orm";
import { Temporal } from "temporal-polyfill";
import { v4 as uuid } from "uuid";
import { DEFAULT_SESSION_EXPIRY_MS } from "./constants";
import { userSessionTable } from "./user-session-entity";

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
      const sid = uuid();
      const now = Temporal.Now.instant();
      const expiresAt = now.add({ milliseconds: ttlMs });
      await db.insert(userSessionTable).values({
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
      await db
        .update(userSessionTable)
        .set({ revokedAt: Temporal.Now.instant() })
        .where(and(eq(userSessionTable["id"], sid), isNull(userSessionTable["revokedAt"])));
    },

    async sessionChecker(sid: string, expectedUserId: string): Promise<AuthSessionStatus> {
      const rows = await db
        .select({
          userId: userSessionTable["userId"],
          revokedAt: userSessionTable["revokedAt"],
          expiresAt: userSessionTable["expiresAt"],
        })
        .from(userSessionTable)
        .where(eq(userSessionTable["id"], sid))
        .limit(1);
      const row = rows[0];
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
      return "live";
    },

    async sessionMassRevoker(userId: string): Promise<number> {
      // Count is accurate because we only touch live rows — a previously
      // revoked row stays in its state and isn't double-counted.
      const result = await db
        .update(userSessionTable)
        .set({ revokedAt: Temporal.Now.instant() })
        .where(and(eq(userSessionTable["userId"], userId), isNull(userSessionTable["revokedAt"])))
        .returning({ id: userSessionTable["id"] });
      return result.length;
    },
  };
}
