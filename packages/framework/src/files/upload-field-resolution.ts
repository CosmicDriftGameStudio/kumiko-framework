import type { AnyFileFieldDef } from "@cosmicdrift/kumiko-types/fields";
import { isFileField } from "../engine/field-helpers.ts";
import type { Registry } from "../engine/types/index.ts";
import { isActionFormScreenQn, resolveActionFormFileField } from "./action-form-upload.ts";
import { resolveFileSubField } from "./file-field-slots.ts";
import { parseMaxSize } from "./types.ts";

type UploadTarget = {
  readonly entityType?: string | undefined;
  readonly entityId?: string | undefined;
  readonly fieldName?: string | undefined;
  readonly subField?: string | undefined;
  readonly actionForm?: string | undefined;
};

export type AttachTargets = "entities" | "entities-and-read-models";

type AttachedFieldResolution =
  | { readonly kind: "unattached" }
  | { readonly kind: "resolved"; readonly fieldDef: AnyFileFieldDef }
  | { readonly kind: "unresolvable" };

function findAttachEntity(
  registry: Registry | undefined,
  entityType: string,
  attachTargets: AttachTargets,
) {
  return (
    registry?.getEntity(entityType) ??
    (attachTargets === "entities-and-read-models"
      ? registry?.getReadModelEntity(entityType)
      : undefined)
  );
}

// entityType/fieldName drive the GDPR-forget decision downstream
// (fileRefDeleteHook resolves the field's PII annotation from exactly this
// pairing) — attaching to a field nobody can resolve would leave that
// decision hanging on an unverified client string. `subField` names a file sub-field of an
// embedded `fieldName`; the binding stays on the top-level field. Either both are omitted
// (unattached upload, allowed) or both must resolve to a real registered
// field. "entities-and-read-models" is for server-side callers only: a client upload must
// never name a projection entity, whose rows nobody can write-check.
export function resolveAttachedField(
  registry: Registry | undefined,
  entityType: string | undefined,
  fieldName: string | undefined,
  attachTargets: AttachTargets = "entities",
  subField?: string,
): AttachedFieldResolution {
  if (entityType === undefined && fieldName === undefined) return { kind: "unattached" };
  if (!entityType || !fieldName) return { kind: "unresolvable" };
  const fieldDef = findAttachEntity(registry, entityType, attachTargets)?.fields[fieldName];
  if (!fieldDef) return { kind: "unresolvable" };
  if (subField !== undefined) {
    const subFieldDef = resolveFileSubField(fieldDef, subField);
    return subFieldDef === undefined
      ? { kind: "unresolvable" }
      : { kind: "resolved", fieldDef: subFieldDef };
  }
  if (!isFileField(fieldDef)) return { kind: "unresolvable" };
  return { kind: "resolved", fieldDef };
}

type UploadFieldResolution =
  | AttachedFieldResolution
  | { readonly kind: "rejected"; readonly error: string };

export function resolveUploadField(
  registry: Registry | undefined,
  input: UploadTarget,
  attachTargets: AttachTargets | undefined,
): UploadFieldResolution {
  const { entityType, entityId, fieldName, subField, actionForm } = input;
  if (actionForm === undefined) {
    return resolveAttachedField(registry, entityType, fieldName, attachTargets, subField);
  }
  if (subField !== undefined) {
    return {
      kind: "rejected",
      error: "invalid_action_form: actionForm cannot be combined with subField",
    };
  }
  if (entityType !== undefined || entityId !== undefined) {
    return {
      kind: "rejected",
      error: "invalid_action_form: actionForm cannot be combined with entityType/entityId",
    };
  }
  if (!isActionFormScreenQn(actionForm)) {
    return {
      kind: "rejected",
      error: "invalid_action_form: expected a screen QN like <feature>:screen:<id>",
    };
  }
  const fieldDef =
    fieldName !== undefined
      ? resolveActionFormFileField(registry, actionForm, fieldName)
      : undefined;
  if (fieldDef === undefined) {
    return {
      kind: "rejected",
      error:
        "unresolvable_field: actionForm and fieldName must name a files/image field of a registered actionForm screen",
    };
  }
  return { kind: "resolved", fieldDef };
}

const anonymousUploadRegistries = new WeakMap<Registry, boolean>();

export function registryHasAnonymousUploadField(registry: Registry | undefined): boolean {
  if (registry === undefined) return false;
  const cached = anonymousUploadRegistries.get(registry);
  if (cached !== undefined) return cached;
  let found = false;
  for (const [, entity] of registry.getAllEntities()) {
    for (const fieldDef of Object.values(entity.fields)) {
      if (isFileField(fieldDef) && fieldDef.anonymousUpload === true) found = true;
    }
  }
  anonymousUploadRegistries.set(registry, found);
  return found;
}

// Anonymous uploads stay pending (no record, no action form) and only into an opted-in field;
// the upload response hands the visitor the claim handle that later binds the file.
export function isAnonymousPendingUploadAllowed(
  registry: Registry | undefined,
  target: UploadTarget,
): boolean {
  if (target.entityId !== undefined || target.actionForm !== undefined) return false;
  const resolution = resolveAttachedField(registry, target.entityType, target.fieldName);
  return (
    resolution.kind === "resolved" &&
    isFileField(resolution.fieldDef) &&
    resolution.fieldDef.anonymousUpload === true
  );
}

// The anonymous body cap: the largest opted-in field, not the registry-wide largest, so a
// visitor cannot make the server buffer a body only an authenticated field would accept.
export function resolveMaxAnonymousUploadBytes(
  registry: Registry | undefined,
  defaultMaxSize: string,
): number {
  let maxBytes = 0;
  for (const entity of registry?.getAllEntities().values() ?? []) {
    for (const fieldDef of Object.values(entity.fields)) {
      if (isFileField(fieldDef) && fieldDef.anonymousUpload === true) {
        maxBytes = Math.max(maxBytes, parseMaxSize(fieldDef.maxSize ?? defaultMaxSize));
      }
    }
  }
  return maxBytes;
}
