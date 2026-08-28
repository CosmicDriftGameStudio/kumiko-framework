import type {
  AuthSessionCheckResult,
  SessionChecker,
  SessionCreator,
  SessionMassRevoker,
  SessionMetadata,
  SessionRevoker,
} from "@cosmicdrift/kumiko-framework/api";

export type { SessionMassRevoker } from "@cosmicdrift/kumiko-framework/api";

import { fetchOne, insertOne, updateMany } from "@cosmicdrift/kumiko-framework/bun-db";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import type { SessionUser, TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { buildSessionRoles, SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
import { append } from "@cosmicdrift/kumiko-framework/event-store";
import { generateId, parseRoles } from "@cosmicdrift/kumiko-framework/utils";
import { Temporal } from "temporal-polyfill";
import { encryptForDirectWrite } from "../shared";
import { tenantMembershipsTable } from "../tenant";
import { USER_STATUS, type UserStatus, userTable } from "../user";
import { DEFAULT_SESSION_EXPIRY_MS, LAST_SEEN_REFRESH_MS } from "./constants";
import { userSessionEntity, userSessionTable } from "./schema/user-session";
import {
  SESSION_REVOKED_AGGREGATE_TYPE,
  SESSION_REVOKED_EVENT_QN,
  sessionRevokedSchema,
} from "./session-revoked-event";

// Locked accounts whose live sessions must be refused. deletionRequested is
// intentionally absent — it's a reversible grace period and the user needs
// their session to reach cancel-deletion.
const BLOCKED_STATUSES: ReadonlySet<UserStatus> = new Set([
  USER_STATUS.Restricted,
  USER_STATUS.Deleted,
]);

// Shared with personal-access-tokens' resolver — a PAT belonging to a
// locked-out principal must be refused the same way a live session is.
export function isPrincipalBlocked(status: UserStatus): boolean {
  return BLOCKED_STATUSES.has(status);
}

// Why the callbacks live at the raw-DB level rather than going through the
// dispatcher: session-create/revoke/check run on the hot path of every
// login and every request. The (createdAt/revokedAt/ip/userAgent) columns
// already are the audit trail — a dispatcher roundtrip buys nothing.

// "Sign out everywhere else, keep this one" — used both by the user-facing
// revoke-all-others handler and by other features (auth-mfa) that need the
// same effect from a raw callback instead of a dispatcher round-trip.
// currentSid undefined (stateless-JWT / no sid claim) revokes everything —
// there is no "current" row to spare.
export type SessionAllOthersRevoker = (
  userId: string,
  currentSid: string | undefined,
) => Promise<number>;

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
  sessionRevokeAllOthers: SessionAllOthersRevoker;
};

export function createSessionCallbacks(opts: SessionCallbacksOptions): SessionCallbacks {
  const ttlMs = opts.expiresInMs ?? DEFAULT_SESSION_EXPIRY_MS;
  const { db } = opts;

  return {
    async sessionCreator(user: SessionUser, meta: SessionMetadata): Promise<string> {
      const sid = generateId();
      const now = Temporal.Now.instant();
      const expiresAt = now.add({ milliseconds: ttlMs });
      await insertOne(
        db,
        userSessionTable,
        await encryptForDirectWrite(
          userSessionEntity,
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
      if (row.expiresAt.epochMilliseconds <= Temporal.Now.instant().epochMilliseconds) {
        return "expired";
      }

      // Hourly, not per-request: this check runs on every authenticated
      // request, so a write here has to stay off the hot path.
      const nowMs = Temporal.Now.instant().epochMilliseconds;
      if (!row.lastSeenAt || row.lastSeenAt.epochMilliseconds + LAST_SEEN_REFRESH_MS <= nowMs) {
        try {
          await updateMany(
            db,
            userSessionTable,
            { lastSeenAt: Temporal.Now.instant() },
            { id: sid },
          );
        } catch {
          // fail-open: a refresh failure must not block the session check
        }
      }

      // Defense-in-depth: status flips (Art. 18 restrict, forget) revoke
      // sessions, but a missed revoke must not keep a locked account alive on
      // a stale sid. Fail-OPEN on a lookup miss — this is the second layer,
      // revocation is primary; never turn a user-row miss into a global
      // lockout. (+1 PK read on read_users per authenticated request.)
      //
      // Fail-open covers a THROW *and* a null-miss, not just a throw: this
      // read sits on the hot path of every authenticated request, and a
      // missing row here means we have no DB-confirmed roles to derive from
      // (e.g. a bootstrap/system actor with no persisted user row) — that is
      // a different situation from tenantMembershipsTable below, where a
      // missing row is a legitimate "no tenant roles" outcome. Both branches
      // return the bare "live" string (no re-derived roles) — the middleware
      // falls back to the JWT's frozen roles claim.
      let user: { status: UserStatus; roles: string | null } | undefined;
      try {
        user = await fetchOne<{ status: UserStatus; roles: string | null }>(db, userTable, {
          id: expectedUserId,
        });
      } catch {
        return "live";
      }
      if (!user) return "live";
      if (isPrincipalBlocked(user.status)) return "blocked";

      // Same fail-open reasoning as the userTable lookup above — a transient
      // DB error on the membership read must not lock the user out. A
      // missing row (not a throw) is a valid outcome: the user genuinely has
      // no tenant-scoped roles for row.tenantId, so membershipRoles is [].
      let membershipRoles: readonly string[];
      try {
        const membership = await fetchOne<{ roles: string | null }>(db, tenantMembershipsTable, {
          userId: expectedUserId,
          tenantId: row.tenantId,
        });
        membershipRoles = membership ? parseRoles(membership.roles) : [];
      } catch {
        return "live";
      }

      const globalRoles = parseRoles(user.roles);
      const roles = buildSessionRoles(globalRoles, membershipRoles);
      return { status: "live", roles } as const;
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

      // Lightweight append alongside the direct-write above, same pattern
      // as revoke.write.ts (#1559) — this callback is the password-change
      // auto-revoke path (sessions/feature.ts postSave hook) and has no
      // dispatcher ctx to call unsafeAppendEvent from, so it uses the raw
      // append() like revoke-all-for-user.write.ts does. Without this, the
      // access-invalidation consumer (#1560) never hears about a password
      // change and an already-open SSE stream survives it — the exact
      // "stale JWT mid-stream" gap this feature exists to close.
      if (result.length > 0) {
        const payload = sessionRevokedSchema.parse({
          userId,
          sessionIds: result.map((row: { id: string }) => row.id),
        });
        await append(db, {
          aggregateId: generateId(),
          aggregateType: SESSION_REVOKED_AGGREGATE_TYPE,
          tenantId: SYSTEM_TENANT_ID,
          expectedVersion: 0,
          type: SESSION_REVOKED_EVENT_QN,
          payload,
          metadata: { userId },
        });
      }

      return result.length;
    },

    async sessionRevokeAllOthers(userId: string, currentSid: string | undefined): Promise<number> {
      const result = await updateMany(
        db,
        userSessionTable,
        { revokedAt: Temporal.Now.instant() },
        currentSid
          ? { userId, revokedAt: null, id: { ne: currentSid } }
          : { userId, revokedAt: null },
      );

      // Same reasoning as sessionMassRevoker above — this raw callback
      // (used by auth-mfa and other internal callers, distinct from the
      // user-facing revoke-all-others.write.ts handler which already
      // appends this event) needs its own append so callers reached
      // through here also cut open SSE streams.
      if (result.length > 0) {
        const payload = sessionRevokedSchema.parse({
          userId,
          sessionIds: result.map((row: { id: string }) => row.id),
        });
        await append(db, {
          aggregateId: generateId(),
          aggregateType: SESSION_REVOKED_AGGREGATE_TYPE,
          tenantId: SYSTEM_TENANT_ID,
          expectedVersion: 0,
          type: SESSION_REVOKED_EVENT_QN,
          payload,
          metadata: { userId },
        });
      }

      return result.length;
    },
  };
}
