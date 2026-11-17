import { requestContext } from "@cosmicdrift/kumiko-framework/api";
import {
  collectPiiEncryptedFields,
  configuredPiiSubjectKms,
  encryptPiiFieldValues,
  KeyErasedError,
  PII_ERASED_SENTINEL,
} from "@cosmicdrift/kumiko-framework/crypto";
import type { EntityDefinition } from "@cosmicdrift/kumiko-framework/engine";
import { subjectErasedConflict } from "@cosmicdrift/kumiko-framework/errors";
import { decryptStoredPii } from "../shared/index.ts";
import { FIELD_APPROVAL_FEATURE_NAME } from "./constants.ts";

// A PII host field is sealed under the host record's subject (not the request row's) so that
// forgetting the host makes the pending value unreadable.
export async function sealRequestedValue(
  hostEntity: EntityDefinition,
  hostEntityName: string,
  fieldName: string,
  value: unknown,
  hostRow: Record<string, unknown>,
): Promise<string> {
  const json = JSON.stringify(value);
  const kms = configuredPiiSubjectKms();
  if (!kms || !collectPiiEncryptedFields(hostEntity).includes(fieldName)) return json;
  try {
    const sealed = await encryptPiiFieldValues(
      { [fieldName]: json },
      hostEntity,
      [fieldName],
      kms,
      { requestId: requestContext.get()?.requestId ?? FIELD_APPROVAL_FEATURE_NAME },
      { entityName: hostEntityName, subjectSource: hostRow },
    );
    return String(sealed[fieldName]);
  } catch (e) {
    if (e instanceof KeyErasedError) throw subjectErasedConflict(e);
    throw e;
  }
}

export type OpenedRequestedValue = { readonly ok: true; readonly value: unknown } | { readonly ok: false };

export async function openRequestedValue(
  stored: unknown,
  fieldName: string,
): Promise<OpenedRequestedValue> {
  if (typeof stored !== "string") return { ok: false };
  const plain = await decryptStoredPii(stored, fieldName, FIELD_APPROVAL_FEATURE_NAME);
  if (plain === PII_ERASED_SENTINEL) return { ok: false };
  try {
    return { ok: true, value: JSON.parse(plain) };
  } catch {
    return { ok: false };
  }
}
