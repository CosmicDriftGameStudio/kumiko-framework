import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import {
  InternalError,
  UnprocessableError,
  writeFailure,
} from "@cosmicdrift/kumiko-framework/errors";
import { z } from "zod";
import { AuthErrors } from "../constants";
import { invalidUnlockToken } from "../errors";
import { clearLockoutState } from "../lockout-store";
import { verifyUnlockToken } from "../unlock-token";

export type ConfirmAccountUnlockOptions = {
  readonly hmacSecret: string;
};

// Confirm step of the unlock flow. Unlike reset/verify, there's no entity
// write: the token's HMAC signature already proves it was minted for an
// existing, non-deleted user (see request-account-unlock.write.ts's
// findForAuth + extraSilentSkip), so there's no user to (re-)load or
// validate here. Clearing the Redis lockout state is naturally idempotent
// (DEL on an already-cleared/missing key is a no-op), so a replayed unlock
// link within its TTL just re-clears — harmless, unlike reset which sets a
// password. That's why this skips the single-use burn-store confirm-token-
// flow.ts needs to protect a state-changing write.
export function createConfirmAccountUnlockHandler(opts: ConfirmAccountUnlockOptions) {
  return defineWriteHandler({
    name: "confirm-account-unlock",
    schema: z.object({
      token: z.string().min(1),
    }),
    access: { roles: ["all"] },
    handler: async (event, ctx) => {
      if (!opts.hmacSecret) {
        return writeFailure(
          new UnprocessableError(AuthErrors.unlockNotConfigured, {
            i18nKey: "auth.errors.unlockNotConfigured",
          }),
        );
      }
      if (!ctx.redis) {
        return writeFailure(
          new InternalError({
            message: "account-unlock requires ctx.redis to clear lockout state",
          }),
        );
      }

      // All verify failures (malformed / bad_signature / expired) fold into
      // the same invalid_unlock_token error — a probing caller can't
      // distinguish tampered from stale from random-string.
      const verify = verifyUnlockToken(event.payload.token, opts.hmacSecret);
      if (!verify.ok) return invalidUnlockToken();

      await clearLockoutState(ctx.redis, verify.userId);
      return { isSuccess: true, data: { kind: "account-unlocked" as const } };
    },
  });
}
