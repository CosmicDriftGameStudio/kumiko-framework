import { createTenantDb } from "@cosmicdrift/kumiko-framework/db";
import { defineWriteHandler, type SessionUser } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import { base32Encode } from "../base32";
import { MFA_SETUP_TOKEN_TTL_MINUTES } from "../constants";
import { findUserMfaRow } from "../db/queries";
import { invalidChallengeToken, mfaAlreadyEnabled } from "../errors";
import { verifyMfaPreauthSetupToken } from "../mfa-preauth-setup-token";
import { signMfaSetupToken } from "../mfa-setup-token";
import { buildOtpauthUri } from "../otpauth-uri";
import { generateRecoveryCodes, hashRecoveryCodes } from "../recovery-codes";
import { generateTotpSecret } from "../totp";

export type EnableStartPreauthOptions = {
  // Verifies the incoming preauthSetupToken — must match login.write.ts's
  // mfaStatusChecker (challengeTokenSecret), NOT setupTokenSecret.
  readonly challengeTokenSecret: string;
  // Signs the outgoing secret-carrying setupToken — same secret + token
  // format as enable-start.write.ts, so the later pre-auth confirm step can
  // verify it with the existing verifyMfaSetupToken.
  readonly setupTokenSecret: string;
  readonly issuer: string;
};

// Pre-auth twin of enable-start.write.ts: identity comes from a verified
// preauthSetupToken (minted by login.write.ts when enforcement policy
// blocks an unenrolled user), not from event.user — there is no session at
// this point. Runs pre-session the same way verify.write.ts does (dispatched
// by the framework's /auth/mfa/preauth-enable-start route with GUEST_USER).
export function createEnableStartPreauthHandler(opts: EnableStartPreauthOptions) {
  return defineWriteHandler({
    name: "enable-start-preauth",
    schema: z.object({
      preauthSetupToken: z.string().min(1),
      accountLabel: z.string().min(1).max(200),
    }),
    access: { roles: ["all"] },
    handler: async (event, ctx) => {
      const verified = verifyMfaPreauthSetupToken(
        event.payload.preauthSetupToken,
        opts.challengeTokenSecret,
      );
      // Same generic "sign in again" error as an expired/invalid MFA
      // challenge token — both mean the login-flow token expired, no
      // distinct i18n needed (see #1465's scoping comment).
      if (!verified.ok) return invalidChallengeToken();
      const { userId, tenantId } = verified.payload;

      // "system" mode: the guest dispatch identity's own tenantId is
      // meaningless here — the preauthSetupToken is the source of truth
      // for which tenant's row to read, mirroring verify.write.ts.
      const scopedDb = createTenantDb(ctx.db.raw, tenantId, "system");
      const scopedUser: SessionUser = { id: userId, tenantId, roles: ["User"] };
      const existing = await findUserMfaRow(scopedDb, scopedUser);
      if (existing) return mfaAlreadyEnabled();

      const secret = generateTotpSecret();
      const recoveryCodes = generateRecoveryCodes();
      const recoveryCodeHashes = await hashRecoveryCodes(recoveryCodes);

      const { token: setupToken } = signMfaSetupToken(
        {
          userId,
          totpSecretBase32: base32Encode(secret),
          recoveryCodeHashes,
          tenantId,
        },
        MFA_SETUP_TOKEN_TTL_MINUTES,
        opts.setupTokenSecret,
      );

      return {
        isSuccess: true,
        data: {
          setupToken,
          otpauthUri: buildOtpauthUri({
            issuer: opts.issuer,
            accountLabel: event.payload.accountLabel,
            secret,
          }),
          // Plaintext — this is the one and only time these are shown.
          recoveryCodes,
        },
      };
    },
  });
}
