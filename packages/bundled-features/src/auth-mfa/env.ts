import * as z from "zod";
import { secretsEnvSchema } from "../secrets/index.ts";

const MIN_TOKEN_SECRET_LENGTH = 32;

function tokenSecretOverride(description: string) {
  return z
    .string()
    .min(MIN_TOKEN_SECRET_LENGTH)
    .optional()
    .describe(`${description} Unset: derived from JWT_SECRET.`)
    .meta({ kumiko: { pulumi: { generator: "openssl rand -hex 32", secret: true } } });
}

/** Optional overrides for the two MFA token HMAC keys. Unset, both are
 *  derived from the app's JWT secret, so one env var stays authoritative. */
export const mfaTokenSecretsEnvSchema = z.object({
  MFA_SETUP_TOKEN_SECRET: tokenSecretOverride("HMAC key of the MFA enable-flow token."),
  MFA_CHALLENGE_TOKEN_SECRET: tokenSecretOverride("HMAC key of the MFA login-challenge token."),
});

// Same field instances as `secrets`, so composeEnvSchema treats them as one
// shared variable; an app mounting auth-mfa without `secrets` still gets the
// KEK slot (and its _CIPHERTEXT twin) declared.
export const authMfaEnvSchema = z.object({
  ...secretsEnvSchema.shape,
  ...mfaTokenSecretsEnvSchema.shape,
});
