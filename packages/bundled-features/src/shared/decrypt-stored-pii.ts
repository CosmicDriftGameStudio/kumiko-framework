import { requestContext } from "@cosmicdrift/kumiko-framework/api";
import {
  configuredPiiSubjectKms,
  decryptPiiFieldValues,
} from "@cosmicdrift/kumiko-framework/crypto";

// Raw reads (fetchOne/selectMany) return the stored column value — with an
// active KMS that is ciphertext (self-describing: it names its own subject,
// so no entity/field context is needed for key selection). `field` must
// still match the field name used at encrypt time — it is part of the
// AAD (#1263), so a mismatch fails decrypt loud rather than silently
// letting ciphertext cut-and-pasted from another field decrypt. An erased
// subject yields the sentinel, which matches no real value.
export async function decryptStoredPii(
  value: string,
  field: string,
  fallbackRequestId: string,
): Promise<string> {
  const kms = configuredPiiSubjectKms();
  if (!kms) return value;
  const out = await decryptPiiFieldValues({ [field]: value }, [field], kms, {
    requestId: requestContext.get()?.requestId ?? fallbackRequestId,
  });
  const decrypted = out[field];
  return typeof decrypted === "string" ? decrypted : value;
}
