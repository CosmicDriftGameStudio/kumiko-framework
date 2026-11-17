import type {
  AuthSessionCheckResult,
  SessionChecker,
  SessionCreator,
  SessionMetadata,
  SessionRevoker,
} from "@cosmicdrift/kumiko-framework/api";

import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import { fetchOne, insertOne, transaction, updateMany } from "@cosmicdrift/kumiko-framework/db";
import type { SessionUser, TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { generateId } from "@cosmicdrift/kumiko-framework/utils";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import type { Clock } from "@cosmicdrift/kumiko-types/tz-context";
import { encryptForDirectWrite } from "../shared/index.ts";
import { resolveLiveTenantRoles } from "../tenant/index.ts";
import {
  DEFAULT_SESSION_EXPIRY_MS,
  LAST_SEEN_REFRESH_MS,
  USER_SESSION_ENTITY_NAME,
} from "./constants.ts";
import { revokeSessionsAndAnnounce } from "./revoke-sessions.ts";
import { userSessionEntity, userSessionTable } from "./schema/user-session.ts";

const realClock: Clock = { now: () => Temporal.Now.instant() };

// Why the callbacks live at the raw-DB level rather than going through the
// dispatcher: session-create/revoke/check run on the hot path of every
// login and every request. The (createdAt/revokedAt/ip/userAgent) columns
// already are the audit trail — a dispatcher roundtrip buys nothing.

export type SessionCallbacksOptions = {
  readonly db: DbConnection;
  // Session lifetime. MVP uses a single flat window; per-app policies can
  // come later (e.g. longer for "remember me", shorter for admin).
  readonly expiresInMs?: number;
  // Real time unless a test injects a manual clock to age sessions deterministically.
  readonly clock?: Clock;
};

export type SessionCallbacks = {
  sessionCreator: SessionCreator;
  sessionRevoker: SessionRevoker;
  sessionChecker: SessionChecker;
};

export function createSessionCallbacks(opts: SessionCallbacksOptions): SessionCallbacks {
  const ttlMs = opts.expiresInMs ?? DEFAULT_SESSION_EXPIRY_MS;
  const { db } = opts;
  const clock = opts.clock ?? realClock;

  return {
    async sessionCreator(user: SessionUser, meta: SessionMetadata): Promise<string> {
      const sid = generateId();
      const now = clock.now();
      const expiresAt = now.add({ milliseconds: ttlMs });
      await insertOne(
        db,
        userSessionTable,
        await encryptForDirectWrite(
          userSessionEntity,
          USER_SESSION_ENTITY_NAME,
          {
            id: sid,
            tenantId: user.tenantId,
            userId: user.id,
            createdAt: now,
            expiresAt,
            lastSeenAt: now,
            ip: meta.ip,
            userAgent: meta.userAgent,
          },
          "sessions:create",
        ),
      );
      return sid;
    },

    async sessionRevoker(sid: string): Promise<void> {
      // Only caller is logout/tenant-switch, hence the only source of streamScope "revoked-sessions":
      // without the event a live SSE stream on this sid would outlive its own logout.
      await transaction(db, (tx) =>
        revokeSessionsAndAnnounce(tx, {
          where: { id: sid },
          revokedAt: clock.now(),
          streamScope: "revoked-sessions",
        }),
      );
    },

    // kumiko-lint-ignore complexity-budget session check + lastSeen refresh on hot path
    async sessionChecker(sid: string, expectedUserId: string): Promise<AuthSessionCheckResult> {
      const row = await fetchOne<{
        userId: string;
        tenantId: TenantId;
        revokedAt: unknown;
        expiresAt: { epochMilliseconds: number };
        lastSeenAt: { epochMilliseconds: number } | null;
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
      if (row.expiresAt.epochMilliseconds <= clock.now().epochMilliseconds) {
        return "expired";
      }

      // Hourly, not per-request: this check runs on every authenticated
      // request, so a write here has to stay off the hot path.
      const refreshLastSeen = async (): Promise<void> => {
        const nowMs = clock.now().epochMilliseconds;
        if (row.lastSeenAt && row.lastSeenAt.epochMilliseconds + LAST_SEEN_REFRESH_MS > nowMs) {
          return;
        }
        try {
          await updateMany(db, userSessionTable, { lastSeenAt: clock.now() }, { id: sid });
        } catch {
          // fail-open: a refresh failure must not block the session check
        }
      };

      // Lookup errors propagate like an error on the session read above: a 5xx beats serving
      // the JWT's frozen roles while the DB cannot confirm them.
      const [live] = await Promise.all([
        resolveLiveTenantRoles(db, expectedUserId, row.tenantId),
        refreshLastSeen(),
      ]);

      switch (live.kind) {
        case "active":
          return { status: "live", roles: live.roles } as const;
        // Bootstrap/system actors have no user row (rows are only soft-deleted): keep the JWT roles.
        case "unknown_principal":
          return "live";
        case "blocked":
          return "blocked";
        // Every mint path requires a membership, so a missing row means it was revoked.
        case "not_a_member":
          return "not_a_member";
      }
    },
  };
}
