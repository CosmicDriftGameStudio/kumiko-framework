import { createEventStoreExecutor } from "@cosmicdrift/kumiko-framework/db";
import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { Temporal } from "temporal-polyfill";
import { z } from "zod";
import { base32Decode } from "../base32";
import { invalidSetupToken, invalidTotpCode } from "../errors";
import { verifyMfaSetupToken } from "../mfa-setup-token";
import { userMfaEntity, userMfaTable } from "../schema/user-mfa";
import { verifyTotp } from "../totp";

export type EnableConfirmOptions = {
  readonly setupTokenSecret: string;
  // Wired late by run-prod-app once the sessions feature (if mounted) is
  // concrete — see sessions/session-callbacks.ts. Absent when sessions
  // isn't mounted: enabling MFA just doesn't revoke other sessions.
  readonly revokeAllOtherSessions?: (
    userId: string,
    currentSid: string | undefined,
  ) => Promise<number>;
};

const executor = createEventStoreExecutor(userMfaTable, userMfaEntity, {
  entityName: "user-mfa",
});

export function createEnableConfirmHandler(opts: EnableConfirmOptions) {
  return defineWriteHandler({
    name: "enable-confirm",
    schema: z.object({
      setupToken: z.string().min(1),
      code: z.string().length(6),
    }),
    access: { openToAll: true },
    handler: async (event, ctx) => {
      const verify = verifyMfaSetupToken(event.payload.setupToken, opts.setupTokenSecret);
      if (!verify.ok) return invalidSetupToken();
      // A setup token minted for one user can't be redeemed by another —
      // guards against a leaked/shared token, not just tampering (the HMAC
      // already rules that out).
      if (verify.payload.userId !== event.user.id) return invalidSetupToken();

      const secret = base32Decode(verify.payload.totpSecretBase32);
      if (!verifyTotp(secret, event.payload.code)) return invalidTotpCode();

      const result = await executor.create(
        {
          userId: event.user.id,
          totpSecret: verify.payload.totpSecretBase32,
          // Stored as a JSON string — see schema/user-mfa.ts (recoveryCodes
          // is an encrypted+userOwned text field, both layers need a string).
          recoveryCodes: JSON.stringify({ hashes: verify.payload.recoveryCodeHashes }),
          enabledAt: Temporal.Now.instant(),
          lastUsedAt: null,
        },
        event.user,
        ctx.db,
      );
      if (!result.isSuccess) return result;

      // Confirming enable proves possession of a second factor — every
      // other session (a stolen-cookie attacker included) gets logged out.
      // The session that just did this confirm keeps running.
      if (opts.revokeAllOtherSessions) {
        await opts.revokeAllOtherSessions(event.user.id, event.user.sid);
      }

      return { isSuccess: true, data: { enabled: true } };
    },
  });
}
