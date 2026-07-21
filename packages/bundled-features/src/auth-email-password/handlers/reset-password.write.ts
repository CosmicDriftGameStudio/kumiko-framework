import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { UnprocessableError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import { z } from "zod";
import { hashPassword } from "../../shared";
import { AuthErrors } from "../constants";
import { invalidResetToken } from "../errors";
import { passwordSchema } from "../password-policy";
import { verifyResetToken } from "../reset-token";
import { runConfirmTokenFlow } from "./confirm-token-flow";

export type ResetPasswordOptions = {
  readonly hmacSecret: string;
};

// Confirm step of the reset flow. Token-verify happens inline; the
// post-verify pipeline (burn, load user, memberships, try-all-tenants,
// burn-release-on-failure) lives in confirm-token-flow to stay in sync
// with verify-email. Session revocation on password change is wired
// cross-feature via the sessions feature's r.entityHook("postSave",
// "user", ...) — no explicit revoke call needed here.
export function createResetPasswordHandler(opts: ResetPasswordOptions) {
  return defineWriteHandler({
    name: "reset-password",
    schema: z.object({
      token: z.string().min(1),
      newPassword: passwordSchema,
    }),
    access: { roles: ["all"] },
    handler: async (event, ctx) => {
      if (!opts.hmacSecret) {
        return writeFailure(
          new UnprocessableError(AuthErrors.resetNotConfigured, {
            i18nKey: "auth.errors.resetNotConfigured",
          }),
        );
      }

      // All verify failures (malformed / bad_signature / expired) fold into
      // the same invalid_reset_token error — a probing caller can't
      // distinguish tampered from stale from random-string.
      const verify = verifyResetToken(event.payload.token, opts.hmacSecret);
      if (!verify.ok) return invalidResetToken();

      return runConfirmTokenFlow(ctx, verify.userId, verify.expiresAtMs, {
        purpose: "reset",
        redisRequiredMessage: "password-reset requires ctx.redis to enforce token single-use",
        invalidToken: invalidResetToken,
        buildChanges: async () => ({
          passwordHash: await hashPassword(event.payload.newPassword),
        }),
        successData: { kind: "password-reset" as const },
      });
    },
  });
}
