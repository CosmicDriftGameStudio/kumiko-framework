import { requestContext } from "@cosmicdrift/kumiko-framework/api";
import {
  collectPiiSubjectFields,
  configuredPiiSubjectKms,
  encryptPiiFieldValues,
  KeyErasedError,
} from "@cosmicdrift/kumiko-framework/crypto";
import type { EntityDefinition } from "@cosmicdrift/kumiko-framework/engine";
import { subjectErasedConflict } from "@cosmicdrift/kumiko-framework/errors";

// Unmanaged direct-write stores (r.unmanagedTable) skip the executor, so its
// PII encryption never runs — every insert of subject-annotated fields must
// go through this instead, and the feature declares { piiEncryptedOnWrite:
// true } at the registration site (enforced by the registry, #820).
export async function encryptForDirectWrite(
  entity: EntityDefinition,
  entityName: string,
  row: Record<string, unknown>,
  fallbackRequestId: string,
): Promise<Record<string, unknown>> {
  const kms = configuredPiiSubjectKms();
  if (!kms) return row;
  try {
    return await encryptPiiFieldValues(
      row,
      entity,
      collectPiiSubjectFields(entity),
      kms,
      { requestId: requestContext.get()?.requestId ?? fallbackRequestId },
      { entityName },
    );
  } catch (e) {
    if (e instanceof KeyErasedError) throw subjectErasedConflict(e);
    throw e;
  }
}
