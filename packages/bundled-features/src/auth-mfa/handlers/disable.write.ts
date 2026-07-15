import { createEventStoreExecutor } from "@cosmicdrift/kumiko-framework/db";
import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
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

      const verify = await verifyMfaFactor(row, event.payload.code);
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
