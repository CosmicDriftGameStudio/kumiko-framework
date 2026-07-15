import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import { base32Encode } from "../base32";
import { MFA_SETUP_TOKEN_TTL_MINUTES } from "../constants";
import { findUserMfaRow } from "../db/queries";
import { mfaAlreadyEnabled } from "../errors";
import { signMfaSetupToken } from "../mfa-setup-token";
import { buildOtpauthUri } from "../otpauth-uri";
import { generateRecoveryCodes, hashRecoveryCodes } from "../recovery-codes";
import { generateTotpSecret } from "../totp";

export type EnableStartOptions = {
  readonly setupTokenSecret: string;
  readonly issuer: string;
};

// Stateless setup: no `userMfa` row is created here. The generated secret +
// recovery-code hashes are signed into a short-lived `setupToken` (see
// mfa-setup-token.ts) that `enable-confirm` verifies. An abandoned setup
// (user closes the tab without entering a code) leaves zero trace — no
// cleanup job needed for orphaned "pending MFA" rows.
export function createEnableStartHandler(opts: EnableStartOptions) {
  return defineWriteHandler({
    name: "enable-start",
    schema: z.object({
      // Client-supplied label for the otpauth:// URI / authenticator-app
      // entry (typically the user's own email) — avoids an extra DB lookup
      // for something the already-authenticated client already knows about
      // itself.
      accountLabel: z.string().min(1).max(200),
    }),
    access: { openToAll: true },
    handler: async (event, ctx) => {
      const existing = await findUserMfaRow(ctx.db, event.user.id, event.user.tenantId);
      if (existing) return mfaAlreadyEnabled();

      const secret = generateTotpSecret();
      const recoveryCodes = generateRecoveryCodes();
      const recoveryCodeHashes = await hashRecoveryCodes(recoveryCodes);

      const { token: setupToken } = signMfaSetupToken(
        {
          userId: event.user.id,
          totpSecretBase32: base32Encode(secret),
          recoveryCodeHashes,
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
