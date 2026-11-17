import { createEventStoreExecutor } from "@cosmicdrift/kumiko-framework/db";
import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { InternalError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import * as z from "zod";
import { revokeAllUserCredentials } from "../../auth-foundation/index.ts";
import { MFA_CREDENTIAL_REVOKE_REASON } from "../credential-revoke-reason.ts";
import { findUserMfaRow } from "../db/queries.ts";
import { invalidTotpCode, mfaNotEnabled } from "../errors.ts";
import { generateRecoveryCodes, hashRecoveryCodes } from "../recovery-codes.ts";
import { encodeRecoveryCodes, userMfaEntity, userMfaTable } from "../schema/user-mfa.ts";
import { verifyMfaFactor } from "../verify-factor.ts";

const executor = createEventStoreExecutor(userMfaTable, userMfaEntity, {
  entityName: "user-mfa",
});

// Invalidates ALL existing recovery codes (even unused ones) and issues a
// fresh set of 8 — the standard response to "I think my recovery codes
// leaked" without having to disable+re-enable TOTP itself.
export function createRegenerateRecoveryHandler() {
  return defineWriteHandler({
    name: "regenerate-recovery",
    schema: z.object({ code: z.string().min(6).max(9) }),
    rateLimit: { per: "user+handler", limit: 5, windowSeconds: 300 },
    escapeHatch: { grants: ["unsafeRaw"], reason: MFA_CREDENTIAL_REVOKE_REASON },
    access: {
      openToAll: {
        reason:
          "each signed-in user may regenerate only their own recovery codes after proving " +
          "possession of a TOTP or recovery code; the handler looks up the caller's own user-mfa row",
      },
    },
    description:
      "Destroys every existing recovery code of the caller, including unused ones, and returns a fresh set once in plaintext; use it when recovery codes may have leaked but TOTP itself should stay enrolled.",
    // Returns a fresh set of plaintext recovery codes — same transcript leak as
    // enable-start.
    agent: { expose: false },
    handler: async (event, ctx) => {
      const row = await findUserMfaRow(ctx.db, event.user);
      if (!row) return mfaNotEnabled();

      // Proof of possession before wiping the old codes — a TOTP code or
      // (deliberately) one of the very codes about to be replaced both
      // count, since either way the presented code is consumed/irrelevant
      // afterward.
      //
      // Fail closed, matching verify.write.ts/enable-confirm-preauth.write.ts:
      // without ctx.services.redis, verifyMfaFactor's TOTP-replay burn is skipped,
      // letting an observed code be replayed within the ±1-step window to
      // regenerate (and thus invalidate) recovery codes — a session-authed
      // route, so pre-unwiring JWTs stay a valid attack path.
      if (!ctx.services.redis) {
        return writeFailure(
          new InternalError({
            message:
              "regenerate-recovery (mfa) requires ctx.services.redis for TOTP replay protection",
          }),
        );
      }
      const replay = { redis: ctx.services.redis, userId: event.user.id };
      const verify = await verifyMfaFactor(row, event.payload.code, replay);
      if (!verify.ok) return invalidTotpCode();

      const newCodes = generateRecoveryCodes();
      const newHashes = await hashRecoveryCodes(newCodes);

      const result = await executor.update(
        {
          id: row.id,
          version: row.version,
          changes: { recoveryCodes: encodeRecoveryCodes(newHashes) },
        },
        event.user,
        ctx.db,
      );
      if (!result.isSuccess) return result;

      await revokeAllUserCredentials(ctx.registry, ctx.db.unsafeRaw(), event.user.id, {
        keepSessionId: event.user.sid,
      });

      // Plaintext — shown once, same as the initial enable-flow codes.
      return { isSuccess: true, data: { recoveryCodes: newCodes } };
    },
  });
}
