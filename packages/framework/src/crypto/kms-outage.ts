import { KumikoError } from "../errors/kumiko-error.ts";
import { KeyAlreadyExistsError, KeyErasedError, KeyNotFoundError } from "./kms-adapter.ts";

export const ENCRYPTION_UNAVAILABLE_CODE = "encryption_unavailable";

// The key store failed (database, Key Manager, network), so nothing could be encrypted or decrypted.
// A caller retries later: the outage says nothing about the record it was writing.
export class EncryptionUnavailableError extends KumikoError {
  readonly code = ENCRYPTION_UNAVAILABLE_CODE;
  readonly httpStatus = 503;

  constructor(cause?: Error) {
    super({
      message: "the PII key store is unavailable",
      i18nKey: "errors.internal",
      ...(cause && { cause }),
    });
  }
}

function isKeyStateError(error: unknown): boolean {
  return (
    error instanceof KeyErasedError ||
    error instanceof KeyNotFoundError ||
    error instanceof KeyAlreadyExistsError
  );
}

// Key-state errors are answers of a working key store and keep their own type for the callers that
// branch on them; everything else thrown by the adapter is the store itself failing.
export async function classifyKmsOutage<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (isKeyStateError(error) || error instanceof KumikoError) throw error;
    throw new EncryptionUnavailableError(error instanceof Error ? error : undefined);
  }
}
