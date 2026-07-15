import { createEventStoreExecutor, createTenantDb } from "@cosmicdrift/kumiko-framework/db";
import {
  buildSessionRoles,
  createSystemUser,
  defineWriteHandler,
  type SessionUser,
} from "@cosmicdrift/kumiko-framework/engine";
import { parseRoles } from "@cosmicdrift/kumiko-framework/utils";
import { z } from "zod";
import { burnToken } from "../../shared";
import { UserQueries } from "../../user";
import { MFA_VERIFY_LOCKOUT_MINUTES, MFA_VERIFY_MAX_ATTEMPTS } from "../constants";
import { findUserMfaRow } from "../db/queries";
import { invalidChallengeToken, invalidTotpCode, tooManyAttempts } from "../errors";
import { verifyMfaChallengeToken } from "../mfa-challenge-token";
import {
  clearMfaVerifyAttempts,
  getMfaVerifyLockoutState,
  recordFailedMfaVerifyAttempt,
} from "../mfa-verify-attempts";
import { userMfaEntity, userMfaTable } from "../schema/user-mfa";
import { verifyMfaFactor } from "../verify-factor";

export type MfaVerifyOptions = {
  // Must match the secret the login handler signs mfa-challenge tokens
  // with — distinct from setupTokenSecret (different token purpose).
  readonly challengeTokenSecret: string;
  readonly maxAttempts?: number;
  readonly lockoutMinutes?: number;
};

const executor = createEventStoreExecutor(userMfaTable, userMfaEntity, {
  entityName: "user-mfa",
});

// Completes the two-step login. Runs pre-session (dispatched by the
// framework's /auth/mfa/verify route with a guest identity, same as
// login.write.ts) — everything it needs (which user, which tenant) comes
// from the challenge token, not from an authenticated caller.
export function createMfaVerifyHandler(opts: MfaVerifyOptions) {
  const maxAttempts = opts.maxAttempts ?? MFA_VERIFY_MAX_ATTEMPTS;
  const lockoutMinutes = opts.lockoutMinutes ?? MFA_VERIFY_LOCKOUT_MINUTES;

  return defineWriteHandler({
    name: "verify",
    schema: z.object({ challengeToken: z.string().min(1), code: z.string().min(6).max(9) }),
    access: { roles: ["all"] },
    handler: async (event, ctx) => {
      const verified = verifyMfaChallengeToken(
        event.payload.challengeToken,
        opts.challengeTokenSecret,
      );
      if (!verified.ok) return invalidChallengeToken();
      const { userId, tenantId } = verified.payload;

      // Per-account brute-force cap — survives challenge-token reissuance
      // on purpose (see mfa-verify-attempts.ts header). Checked BEFORE the
      // TOTP/recovery verify so a locked account can't be guessed against.
      if (ctx.redis) {
        const state = await getMfaVerifyLockoutState(ctx.redis, userId);
        if (state?.lockedUntil !== null && state?.lockedUntil !== undefined) {
          const now = Date.now();
          if (state.lockedUntil > now) {
            const retryAfterSeconds = Math.max(1, Math.ceil((state.lockedUntil - now) / 1000));
            return tooManyAttempts(retryAfterSeconds);
          }
        }
      }

      // "system" mode: this handler runs with a guest identity whose own
      // tenantId is meaningless here — the challenge token is the source
      // of truth for which tenant's row to read.
      const scopedDb = createTenantDb(ctx.db.raw, tenantId, "system");
      const scopedUser: SessionUser = { id: userId, tenantId, roles: ["User"] };
      const row = await findUserMfaRow(scopedDb, scopedUser);
      // MFA got disabled between login and verify (race, or a stale
      // challenge token from before a disable) — same generic error as a
      // bad code, no detail leak about account state.
      if (!row) return invalidChallengeToken();

      const verify = await verifyMfaFactor(row, event.payload.code);
      if (!verify.ok) {
        if (ctx.redis) {
          await recordFailedMfaVerifyAttempt(ctx.redis, userId, maxAttempts, lockoutMinutes);
        }
        return invalidTotpCode();
      }

      // Recovery-code use consumes the code — persist the reduced hash-list
      // immediately so it can't be replayed. Without this a recovery code
      // would work forever instead of being single-use.
      if (verify.method === "recovery") {
        const updateResult = await executor.update(
          {
            id: row.id,
            version: row.version,
            changes: { recoveryCodes: { hashes: verify.remainingHashes } },
          },
          scopedUser,
          scopedDb,
        );
        if (!updateResult.isSuccess) return updateResult;
      }

      if (ctx.redis) {
        // Burn AFTER a successful verify — a still-failing attempt must not
        // consume the token, or a fat-fingered code would strand the user.
        await burnToken(ctx.redis, "mfa-challenge", userId, verified.expiresAtMs);
        await clearMfaVerifyAttempts(ctx.redis, userId);
      }

      // Re-derive the full session the way login.write.ts would have, for
      // the SAME tenant the challenge token already committed to (no
      // "pick a tenant" step here — that already happened at login time).
      const systemUser = createSystemUser(tenantId, ["SystemAdmin"]);
      const userRow = (await ctx.queryAs(systemUser, UserQueries.detail, {
        id: userId,
      })) as { roles?: string | null } | null; // @cast-boundary engine-payload
      const globalRoles = parseRoles(userRow?.roles ?? null);

      const memberships = (await ctx.queryAs(systemUser, "tenant:query:memberships", {
        userId,
      })) as ReadonlyArray<{ tenantId: string; roles: readonly string[] }>; // @cast-boundary engine-payload
      const membership = memberships.find((m) => m.tenantId === tenantId);
      const mergedRoles = buildSessionRoles(globalRoles, membership?.roles ?? []);

      const baseSession: SessionUser = { id: userId, tenantId, roles: mergedRoles };
      const claims = await ctx.resolveAuthClaims(baseSession);
      const session: SessionUser =
        Object.keys(claims).length > 0 ? { ...baseSession, claims } : baseSession;

      return { isSuccess: true, data: { kind: "mfa-verify-success", session } };
    },
  });
}
