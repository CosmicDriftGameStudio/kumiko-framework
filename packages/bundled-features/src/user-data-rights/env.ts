import * as z from "zod";

const MIN_DELETION_TOKEN_SECRET_LENGTH = 32;

/** Optional dedicated HMAC key of the anonymous deletion-confirmation links. */
export const deletionTokenSecretEnvSchema = z.object({
  DELETION_TOKEN_SECRET: z
    .string()
    .min(MIN_DELETION_TOKEN_SECRET_LENGTH)
    .optional()
    .describe(
      "Dedicated HMAC secret for the anonymous deletion-confirmation links. Unset: derived from JWT_SECRET.",
    )
    .meta({ kumiko: { pulumi: { generator: "openssl rand -hex 24", secret: true } } }),
});
