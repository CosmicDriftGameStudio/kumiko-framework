import { requestContext } from "@cosmicdrift/kumiko-framework/api";
import {
  collectPiiSubjectFields,
  configuredPiiSubjectKms,
  encryptPiiFieldValues,
} from "@cosmicdrift/kumiko-framework/crypto";
import type { EntityDefinition } from "@cosmicdrift/kumiko-framework/engine";

// Unmanaged direct-write stores (r.unmanagedTable) skip the executor, so its
// PII encryption never runs — every insert of subject-annotated fields must
// go through this instead, and the feature declares { piiEncryptedOnWrite:
// true } at the registration site (enforced by the registry, #820).
export async function encryptForDirectWrite(
  entity: EntityDefinition,
  row: Record<string, unknown>,
  fallbackRequestId: string,
): Promise<Record<string, unknown>> {
  const kms = configuredPiiSubjectKms();
  if (!kms) return row;
  return encryptPiiFieldValues(row, entity, collectPiiSubjectFields(entity), kms, {
    requestId: requestContext.get()?.requestId ?? fallbackRequestId,
  });
}
