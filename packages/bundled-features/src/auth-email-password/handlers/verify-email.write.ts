import { defineWriteHandler } from "@kumiko/framework/engine";
import { UnprocessableError, writeFailure } from "@kumiko/framework/errors";
import { z } from "zod";
import { AuthErrors } from "../constants";
import { verifyVerificationToken } from "../verification-token";
import { runConfirmTokenFlow } from "./confirm-token-flow";

export type VerifyEmailOptions = {
  readonly hmacSecret: string;
};

const VerifyEmailSchema = z.object({
  token: z.string().min(1),
});

export type VerifyEmailData = { readonly kind: "verified" } | { readonly kind: "already-verified" };

function invalidToken() {
  return writeFailure(
    new UnprocessableError(AuthErrors.invalidVerificationToken, {
      i18nKey: "auth.errors.invalidVerificationToken",
    }),
  );
}

// Sets user.emailVerified = true on a valid token. Idempotent via the
// `alreadyDone` short-circuit — when the row already reads verified
// (reached through another flow), we skip the write but keep the burn
// so replays still see invalid_verification_token on the burn check.
// Sessions are NOT revoked on verification — no security reason to
// nuke active logins when a user finally confirms their address.
export function createVerifyEmailHandler(opts: VerifyEmailOptions) {
  return defineWriteHandler<"verify-email", typeof VerifyEmailSchema, VerifyEmailData>({
    name: "verify-email",
    schema: VerifyEmailSchema,
    access: { roles: ["all"] },
    handler: async (event, ctx) => {
      if (!opts.hmacSecret) {
        return writeFailure(
          new UnprocessableError(AuthErrors.verificationNotConfigured, {
            i18nKey: "auth.errors.verificationNotConfigured",
          }),
        );
      }

      const verify = verifyVerificationToken(event.payload.token, opts.hmacSecret);
      if (!verify.ok) return invalidToken();

      return runConfirmTokenFlow<VerifyEmailData>(ctx, verify.userId, verify.expiresAtMs, {
        purpose: "verify",
        redisRequiredMessage: "email-verification requires ctx.redis to enforce token single-use",
        invalidToken,
        buildChanges: async () => ({ emailVerified: true }),
        successData: { kind: "verified" },
        alreadyDone: {
          check: (me) => me.emailVerified === true,
          data: { kind: "already-verified" },
        },
      });
    },
  });
}
