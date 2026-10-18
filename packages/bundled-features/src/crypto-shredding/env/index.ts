import * as z from "zod";

const GENERATED_KEY = { generator: "openssl rand -base64 32", secret: true } as const;

/** Env block of the subject-key KMS: the platform KEK (and its rotation
 *  predecessor), the blind-index key, the DEK store, and the Key Manager
 *  coordinates for slots delivered as `<NAME>_CIPHERTEXT`. Every field is
 *  optional here; an app that requires crypto-shredding in production enforces
 *  the all-or-none set in its own boot wiring. */
export const kmsEnvSchema = z.object({
  PLATFORM_KEK: z
    .string()
    .min(1)
    .optional()
    .describe(
      "KEK (base64, 32 bytes) that wraps the subject DEKs in the subject-keys store. Losing it makes every encrypted PII field unreadable.",
    )
    .meta({ kumiko: { kms: true, pulumi: GENERATED_KEY } }),
  SUBJECT_KEYS_DATABASE_URL: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Connection URL of the subject-keys database (DEK store). Comes from the database secret, never from Pulumi config.",
    ),
  KUMIKO_BLIND_INDEX_KEY: z
    .string()
    .min(1)
    .optional()
    .describe(
      "HMAC key (base64, 32 bytes) for blind-index columns, the equality lookups on encrypted fields. Kept separate from the KEK.",
    )
    .meta({ kumiko: { kms: true, pulumi: GENERATED_KEY } }),
  PLATFORM_KEK_VERSION: z
    .string()
    .regex(/^\d+$/, "must be a generation number")
    .optional()
    .describe("Active KEK generation (default 1)."),
  PLATFORM_KEK_PREVIOUS: z
    .string()
    .min(1)
    .optional()
    .describe("KEK of the previous generation (base64), set only during a rotation.")
    .meta({ kumiko: { kms: true } }),
  PLATFORM_KEK_PREVIOUS_VERSION: z
    .string()
    .regex(/^\d+$/, "must be a generation number")
    .optional()
    .describe("Generation number of the previous KEK."),
  PLATFORM_KEK_CIPHERTEXT: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Key Manager ciphertext of PLATFORM_KEK, used when PLATFORM_KEK is unset. Not a Pulumi secret: it is useless without the Key Manager key.",
    ),
  PLATFORM_KEK_PREVIOUS_CIPHERTEXT: z
    .string()
    .min(1)
    .optional()
    .describe("Key Manager ciphertext of PLATFORM_KEK_PREVIOUS, rotation only."),
  KUMIKO_BLIND_INDEX_KEY_CIPHERTEXT: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Key Manager ciphertext of KUMIKO_BLIND_INDEX_KEY, wrapped by the same key as the KEK.",
    ),
  KUMIKO_SECRETS_MASTER_KEY_V1_CIPHERTEXT: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Key Manager ciphertext of KUMIKO_SECRETS_MASTER_KEY_V1, wrapped by the same key as the KEK.",
    ),
  PLATFORM_KEK_KMS_KEY_ID: z
    .string()
    .min(1)
    .optional()
    .describe("Scaleway Key Manager key id the ciphertexts were wrapped with."),
  PLATFORM_KEK_KMS_TOKEN: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Scaleway API secret key for the decrypt call. Scope it to KeyManagerKeyDecrypt; a broader key trades the KEK for infrastructure access.",
    )
    .meta({ kumiko: { pulumi: { secret: true } } }),
  PLATFORM_KEK_KMS_REGION: z
    .string()
    .min(1)
    .optional()
    .describe("Key Manager region. Default fr-par."),
});
