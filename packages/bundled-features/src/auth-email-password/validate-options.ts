import { bootRuleError } from "@cosmicdrift/kumiko-framework/engine";
import { AUTH_EMAIL_PASSWORD_BOOT_RULES } from "./boot-rules.ts";
import { MIN_HMAC_SECRET_LENGTH } from "./web/constants.ts";

type SignedTokenFlowOptions = { readonly hmacSecret: string } | undefined;

// ≥32 chars, symmetric to the JWT_SECRET env check: a short HMAC secret
// makes reset/verify tokens forgeable — that's account takeover, so the
// factory fails fast instead of trusting the caller.
export function assertSignedTokenSecretsLongEnough(
  signedTokenFlows: Readonly<Record<string, SignedTokenFlowOptions>>,
): void {
  for (const [optionName, flow] of Object.entries(signedTokenFlows)) {
    if (flow && flow.hmacSecret.length < MIN_HMAC_SECRET_LENGTH) {
      throw bootRuleError(AUTH_EMAIL_PASSWORD_BOOT_RULES.hmacSecretTooShort, {
        message: `[auth-email-password] ${optionName}.hmacSecret must be ≥${MIN_HMAC_SECRET_LENGTH} chars (HMAC-SHA256 token signing)`,
      });
    }
  }
}
