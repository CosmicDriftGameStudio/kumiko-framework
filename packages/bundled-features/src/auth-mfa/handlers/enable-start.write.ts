import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import { UserQueries } from "../../user/constants";
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
      // Optional client-supplied label for the otpauth:// URI / authenticator-
      // app entry. Omitted by the declarative secretMint screen (mint has no
      // input fields) — derived server-side from the caller's own email below.
      accountLabel: z.string().min(1).max(200).optional(),
    }),
    access: { openToAll: true },
    description:
      "Begins TOTP enrollment for the signed-in user by generating a secret plus recovery codes and returning them as a short-lived setup token, an otpauth:// URI, the base32 secret for manual entry and the one-time plaintext recovery codes; nothing is persisted until enable-confirm. accountLabel defaults to the caller's own email.",
    // The result carries the TOTP secret, the otpauth:// URI and the plaintext
    // recovery codes — an agent turn would put all three in the LLM transcript.
    agent: { expose: false },
    handler: async (event, ctx) => {
      const existing = await findUserMfaRow(ctx.db, event.user);
      if (existing) return mfaAlreadyEnabled();

      let accountLabel = event.payload.accountLabel;
      if (!accountLabel) {
        // The declarative secretMint screen has no client component left to
        // read the session email off — derive the otpauth label server-side.
        const me = (await ctx.queryAs(event.user, UserQueries.me, {})) as {
          email?: string;
        } | null; // @cast-boundary engine-payload
        accountLabel = me?.email ?? event.user.id;
      }

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
          otpauthUri: buildOtpauthUri({ issuer: opts.issuer, accountLabel, secret }),
          // The otpauth URI already carries this secret in its query string —
          // surfaced separately for the reveal screen's manual-entry display.
          totpSecret: base32Encode(secret),
          // Plaintext — this is the one and only time these are shown.
          recoveryCodes,
        },
      };
    },
  });
}
