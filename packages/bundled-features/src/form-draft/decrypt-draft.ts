import { requestContext } from "@cosmicdrift/kumiko-framework/api";
import {
  configuredPiiSubjectKms,
  decryptPiiFieldValues,
  isPiiCiphertext,
} from "@cosmicdrift/kumiko-framework/crypto";
import { InternalError } from "@cosmicdrift/kumiko-framework/errors";
import { type FormDraftBlob, formDraftBlobSchema } from "./schemas.ts";

// Raw reads (fetchOne/selectMany/SQL) return the stored column, which is
// ciphertext once the owner's key exists. The field name is part of the AAD,
// so it must stay "draft". An erased owner yields the sentinel string, which
// fails the blob schema and reads as null (no usable draft).
export async function readStoredDraft(stored: unknown): Promise<FormDraftBlob | null> {
  let plain = stored;
  const kms = configuredPiiSubjectKms();
  if (isPiiCiphertext(stored)) {
    // A silent null would make the stale-draft cleanup treat the draft as empty and leak its file refs.
    if (!kms) throw new InternalError({ message: "form-draft: pii kms not configured" });
    const out = await decryptPiiFieldValues({ draft: stored }, ["draft"], kms, {
      requestId: requestContext.get()?.requestId ?? "form-draft:read",
    });
    plain = out["draft"];
  }
  const parsed = formDraftBlobSchema.safeParse(plain);
  return parsed.success ? parsed.data : null;
}
