import { requestContext } from "@cosmicdrift/kumiko-framework/api";
import {
  configuredPiiSubjectKms,
  decryptPiiFieldValues,
} from "@cosmicdrift/kumiko-framework/crypto";

// Raw reads (fetchOne/selectMany) return the stored column value — with an
// active KMS that is ciphertext (self-describing: it names its own subject,
// so no entity/field context is needed). An erased subject yields the
// sentinel, which matches no real value.
export async function decryptStoredPii(value: string, fallbackRequestId: string): Promise<string> {
  const kms = configuredPiiSubjectKms();
  if (!kms) return value;
  const out = await decryptPiiFieldValues({ value }, ["value"], kms, {
    requestId: requestContext.get()?.requestId ?? fallbackRequestId,
  });
  const decrypted = out["value"];
  return typeof decrypted === "string" ? decrypted : value;
}
