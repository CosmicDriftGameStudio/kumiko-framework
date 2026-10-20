import { PII_ERASED_SENTINEL } from "@cosmicdrift/kumiko-framework/crypto";
import { decryptStoredPii } from "../../shared/index.ts";

// findForAuth returns the stored column, which is ciphertext under an active KMS;
// channel-email refuses to mail a ciphertext address. Null for an erased subject.
export async function openStoredUserEmail(
  stored: string,
  fallbackRequestId: string,
): Promise<string | null> {
  const email = await decryptStoredPii(stored, "email", fallbackRequestId);
  return email === PII_ERASED_SENTINEL ? null : email;
}
