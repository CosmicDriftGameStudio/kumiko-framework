import { createEventStoreExecutor, createTenantDb } from "@cosmicdrift/kumiko-framework/db";
import {
  buildSessionRoles,
  createSystemUser,
  defineWriteHandler,
  type SessionUser,
} from "@cosmicdrift/kumiko-framework/engine";
import { parseRoles } from "@cosmicdrift/kumiko-framework/utils";
import { Temporal } from "temporal-polyfill";
import { z } from "zod";
import { burnToken } from "../../shared";
import { USER_STATUS, UserQueries } from "../../user";
import { base32Decode } from "../base32";
import { MFA_VERIFY_LOCKOUT_MINUTES, MFA_VERIFY_MAX_ATTEMPTS } from "../constants";
import { findUserMfaRow } from "../db/queries";
import { invalidSetupToken, invalidTotpCode, mfaAlreadyEnabled, tooManyAttempts } from "../errors";
import { verifyMfaSetupToken } from "../mfa-setup-token";
import {
  clearMfaVerifyAttempts,
  getMfaVerifyLockoutState,
  recordFailedMfaVerifyAttempt,
} from "../mfa-verify-attempts";
import { encodeRecoveryCodes, userMfaEntity, userMfaTable } from "../schema/user-mfa";
import { verifyTotp } from "../totp";

export type EnableConfirmPreauthOptions = {
  // Must match the secret enable-start-preauth.write.ts signs setupTokens
  // with — same secret + format as the session-authed enable-confirm.
  readonly setupTokenSecret: string;
  readonly maxAttempts?: number;
  readonly lockoutMinutes?: number;
  // Wired late by run-prod-app, same shared callback as enable-confirm and
  // enable-start's session-authed siblings.
  readonly revokeAllOtherSessions?: (
    userId: string,
    currentSid: string | undefined,
  ) => Promise<number>;
};

const executor = createEventStoreExecutor(userMfaTable, userMfaEntity, {
  entityName: "user-mfa",
});

// Pre-auth twin of enable-confirm.write.ts: identity comes from the
// verified setupToken (minted by enable-start-preauth.write.ts), not from
// event.user — there is no session yet. Combines enable-confirm's
// enrollment-completion logic with verify.write.ts's session-derivation
// (membership lookup, status re-check, buildSessionRoles) since this IS
// the completion of the blocked login, not just an enrollment step — a
// successful call here logs the user in.
export function createEnableConfirmPreauthHandler(opts: EnableConfirmPreauthOptions) {
  const maxAttempts = opts.maxAttempts ?? MFA_VERIFY_MAX_ATTEMPTS;
  const lockoutMinutes = opts.lockoutMinutes ?? MFA_VERIFY_LOCKOUT_MINUTES;

  return defineWriteHandler({
    name: "enable-confirm-preauth",
    schema: z.object({
      setupToken: z.string().min(1),
      code: z.string().length(6),
    }),
    access: { roles: ["all"] },
    handler: async (event, ctx) => {
      const verify = verifyMfaSetupToken(event.payload.setupToken, opts.setupTokenSecret);
      if (!verify.ok) return invalidSetupToken();
      // A setupToken minted for the session-authed enable-start never
      // carries tenantId (see mfa-setup-token.ts) — reject it here rather
      // than falling back to a guest tenant, that token was never meant to
      // reach this pre-auth endpoint.
      const { userId, tenantId } = verify.payload;
      if (tenantId === undefined) return invalidSetupToken();

      // Same guessing surface as /auth/mfa/verify (a short TOTP code) and
      // the same per-userId cap — deliberately shared counter, see
      // mfa-verify-attempts.ts.
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

      const secret = base32Decode(verify.payload.totpSecretBase32);
      if (verifyTotp(secret, event.payload.code) === false) {
        if (ctx.redis) {
          await recordFailedMfaVerifyAttempt(ctx.redis, userId, maxAttempts, lockoutMinutes);
        }
        return invalidTotpCode();
      }

      // Burn the setup token on the first successful confirm — same
      // single-use guarantee as enable-confirm.write.ts.
      if (ctx.redis) {
        const burnResult = await burnToken(ctx.redis, "mfa-setup", userId, verify.expiresAtMs);
        if (burnResult === "already-used") return invalidSetupToken();
      }

      // "system" mode: no session exists yet, tenantId comes from the
      // verified token, mirroring enable-start-preauth.write.ts.
      const scopedDb = createTenantDb(ctx.db.raw, tenantId, "system");
      const scopedUser: SessionUser = { id: userId, tenantId, roles: ["User"] };
      const existing = await findUserMfaRow(scopedDb, scopedUser);
      if (existing) return mfaAlreadyEnabled();

      const result = await executor.create(
        {
          userId,
          totpSecret: verify.payload.totpSecretBase32,
          recoveryCodes: encodeRecoveryCodes(verify.payload.recoveryCodeHashes),
          enabledAt: Temporal.Now.instant(),
          lastUsedAt: null,
        },
        scopedUser,
        scopedDb,
      );
      if (!result.isSuccess) return result;

      if (ctx.redis) {
        await clearMfaVerifyAttempts(ctx.redis, userId);
      }

      // No currentSid to exclude — this is the first session for this
      // login, not a follow-up on an already-running one.
      if (opts.revokeAllOtherSessions) {
        await opts.revokeAllOtherSessions(userId, undefined);
      }

      // Re-derive the full session the way verify.write.ts does — the
      // setupToken only proves "password + new TOTP secret", not roles;
      // roles come from a fresh membership lookup, same as every other
      // login-completing handler.
      const systemUser = createSystemUser(tenantId, ["SystemAdmin"]);
      const userRow = (await ctx.queryAs(systemUser, UserQueries.findForAuth, {
        id: userId,
      })) as { roles?: string | null; status?: string } | null; // @cast-boundary engine-payload

      if (!userRow) return invalidSetupToken();
      if (
        userRow?.status === USER_STATUS.Restricted ||
        userRow?.status === USER_STATUS.DeletionRequested ||
        userRow?.status === USER_STATUS.Deleted
      ) {
        return invalidSetupToken();
      }

      const globalRoles = parseRoles(userRow?.roles ?? null);

      const memberships = (await ctx.queryAs(systemUser, "tenant:query:memberships", {
        userId,
      })) as ReadonlyArray<{ tenantId: string; roles: readonly string[] }>; // @cast-boundary engine-payload
      const membership = memberships.find((m) => m.tenantId === tenantId);
      if (!membership) return invalidSetupToken();
      // buildSessionRoles calls stripForbiddenMembershipRoles to strip reserved
      // roles from the membership portion (globalRoles keeps SystemAdmin) —
      // read-time backstop against a rebuild-resurrected role, same as
      // verify.write.ts.
      const mergedRoles = buildSessionRoles(globalRoles, membership.roles);

      const baseSession: SessionUser = { id: userId, tenantId, roles: mergedRoles };
      const claims = await ctx.resolveAuthClaims(baseSession);
      const session: SessionUser =
        Object.keys(claims).length > 0 ? { ...baseSession, claims } : baseSession;

      return { isSuccess: true, data: { kind: "mfa-preauth-confirm-success", session } };
    },
  });
}
