import { KumikoError } from "../errors/kumiko-error.ts";

export const PII_CIPHERTEXT_CORRUPT_CODE = "pii_ciphertext_corrupt";

// The stored value does not decrypt under its subject's key although the key store answered:
// damaged bytes, a value copied into another field or subject (the AAD binds both), or a value
// written under another key. A retry fails the same way, unlike EncryptionUnavailableError.
export class PiiCiphertextCorruptError extends KumikoError {
  readonly code = PII_CIPHERTEXT_CORRUPT_CODE;
  readonly httpStatus = 500;

  constructor(
    readonly field: string,
    cause?: Error,
  ) {
    super({
      message: `the stored PII value of field "${field}" does not decrypt under its subject key`,
      i18nKey: "errors.internal",
      ...(cause && { cause }),
    });
  }
}
