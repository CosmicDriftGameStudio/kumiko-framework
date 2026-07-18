import { createEventStoreExecutor } from "@cosmicdrift/kumiko-framework/db";
import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { Temporal } from "temporal-polyfill";
import { z } from "zod";
import { burnToken } from "../../shared";
import { base32Decode } from "../base32";
import { findUserMfaRow } from "../db/queries";
import { invalidSetupToken, invalidTotpCode, mfaAlreadyEnabled } from "../errors";
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
      if (verifyTotp(secret, event.payload.code) === false) return invalidTotpCode();

      // Burn the setup token on the first successful confirm — without this
      // a `disable` doesn't retire it (re-enabling with the secret the user
      // thinks they discarded), and two parallel confirms both proceed to
      // executor.create instead of the second seeing mfa_already_enabled().
      // ponytail: burned here, not unburned on a later executor.create
      // failure (unlike login.write.ts's unburnToken pattern) — self-service
      // enable-start always mints a fresh setup token on demand (no mailed
      // link to go stale), so the realistic failure path (double-confirm
      // race sans Redis) is meant to leave the burn standing. Add
      // unburnToken here if create-failure retries turn out to matter.
      if (ctx.redis) {
        const burnResult = await burnToken(
          ctx.redis,
          "mfa-setup",
          event.user.id,
          verify.expiresAtMs,
        );
        if (burnResult === "already-used") return invalidSetupToken();
      }

      const existing = await findUserMfaRow(ctx.db, event.user);
      if (existing) return mfaAlreadyEnabled();

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
