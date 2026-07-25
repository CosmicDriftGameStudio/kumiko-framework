import { createEventStoreExecutor } from "@cosmicdrift/kumiko-framework/db";
import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { InternalError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import { z } from "zod";
import { findUserMfaRow } from "../db/queries";
import { invalidTotpCode, mfaNotEnabled } from "../errors";
import { userMfaEntity, userMfaTable } from "../schema/user-mfa";
import { verifyMfaFactor } from "../verify-factor";

export type DisableOptions = {
  readonly revokeAllOtherSessions?: (
    userId: string,
    currentSid: string | undefined,
  ) => Promise<number>;
};

const executor = createEventStoreExecutor(userMfaTable, userMfaEntity, {
  entityName: "user-mfa",
});

// A TOTP code or a recovery code both prove possession of the second
// factor — either is accepted to turn MFA back off. Password alone is NOT
// enough: that would make MFA worthless against exactly the "stolen
// password" scenario it exists to defend.
export function createDisableHandler(opts: DisableOptions) {
  return defineWriteHandler({
    name: "disable",
    schema: z.object({ code: z.string().min(6).max(9) }),
    access: { openToAll: true },
    handler: async (event, ctx) => {
      const row = await findUserMfaRow(ctx.db, event.user);
      if (!row) return mfaNotEnabled();

      // Fail closed, matching verify.write.ts/enable-confirm-preauth.write.ts
      // (#1467): without ctx.redis, verifyMfaFactor's TOTP-replay burn is
      // skipped, and a code observed once (phishing proxy/shoulder-surfing)
      // could be replayed within the ±1-step window to disable MFA outright.
      // "no ctx.redis means no one gets through MFA login" doesn't cover
      // this route — it's session-authed, and JWTs issued before Redis was
      // unwired stay valid until they expire.
      if (!ctx.redis) {
        return writeFailure(
          new InternalError({
            message: "disable (mfa) requires ctx.redis for TOTP replay protection",
          }),
        );
      }
      const replay = { redis: ctx.redis, userId: event.user.id };
      const verify = await verifyMfaFactor(row, event.payload.code, replay);
      if (!verify.ok) return invalidTotpCode();

      const result = await executor.delete({ id: row.id }, event.user, ctx.db);
      if (!result.isSuccess) return result;

      // Disabling MFA is a security-relevant state change — same
      // auto-revoke as enable, in case the person doing this isn't the
      // legitimate account owner (attacker with a stolen-but-not-yet-
      // MFA-locked session, or a recovery code obtained via social
      // engineering).
      if (opts.revokeAllOtherSessions) {
        await opts.revokeAllOtherSessions(event.user.id, event.user.sid);
      }

      return { isSuccess: true, data: { disabled: true } };
    },
  });
}
