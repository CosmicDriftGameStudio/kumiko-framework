import { createEventStoreExecutor } from "@cosmicdrift/kumiko-framework/db";
import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import { findUserMfaRow } from "../db/queries";
import { invalidTotpCode, mfaNotEnabled } from "../errors";
import { generateRecoveryCodes, hashRecoveryCodes } from "../recovery-codes";
import { userMfaEntity, userMfaTable } from "../schema/user-mfa";
import { verifyMfaFactor } from "../verify-factor";

export type RegenerateRecoveryOptions = {
  readonly revokeAllOtherSessions?: (
    userId: string,
    currentSid: string | undefined,
  ) => Promise<number>;
};

const executor = createEventStoreExecutor(userMfaTable, userMfaEntity, {
  entityName: "user-mfa",
});

// Invalidates ALL existing recovery codes (even unused ones) and issues a
// fresh set of 8 — the standard response to "I think my recovery codes
// leaked" without having to disable+re-enable TOTP itself.
export function createRegenerateRecoveryHandler(opts: RegenerateRecoveryOptions) {
  return defineWriteHandler({
    name: "regenerate-recovery",
    schema: z.object({ code: z.string().min(6).max(9) }),
    access: { openToAll: true },
    handler: async (event, ctx) => {
      const row = await findUserMfaRow(ctx.db, event.user);
      if (!row) return mfaNotEnabled();

      // Proof of possession before wiping the old codes — a TOTP code or
      // (deliberately) one of the very codes about to be replaced both
      // count, since either way the presented code is consumed/irrelevant
      // afterward.
      const verify = await verifyMfaFactor(row, event.payload.code);
      if (!verify.ok) return invalidTotpCode();

      const newCodes = generateRecoveryCodes();
      const newHashes = await hashRecoveryCodes(newCodes);

      const result = await executor.update(
        {
          id: row.id,
          version: row.version,
          changes: { recoveryCodes: JSON.stringify({ hashes: newHashes }) },
        },
        event.user,
        ctx.db,
      );
      if (!result.isSuccess) return result;

      if (opts.revokeAllOtherSessions) {
        await opts.revokeAllOtherSessions(event.user.id, event.user.sid);
      }

      // Plaintext — shown once, same as the initial enable-flow codes.
      return { isSuccess: true, data: { recoveryCodes: newCodes } };
    },
  });
}
