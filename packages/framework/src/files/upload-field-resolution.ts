import type { AnyFileFieldDef } from "@cosmicdrift/kumiko-types/fields";
import { isFileField } from "../engine/field-helpers.ts";
import type { Registry } from "../engine/types/index.ts";
import { isActionFormScreenQn, resolveActionFormFileField } from "./action-form-upload.ts";

type UploadTarget = {
  readonly entityType?: string | undefined;
  readonly entityId?: string | undefined;
  readonly fieldName?: string | undefined;
  readonly actionForm?: string | undefined;
};

export type AttachTargets = "entities" | "entities-and-read-models";

type AttachedFieldResolution =
  | { readonly kind: "unattached" }
  | { readonly kind: "resolved"; readonly fieldDef: AnyFileFieldDef }
  | { readonly kind: "unresolvable" };

// entityType/fieldName drive the GDPR-forget decision downstream
// (fileRefDeleteHook resolves the field's PII annotation from exactly this
// pairing) — attaching to a field nobody can resolve would leave that
// decision hanging on an unverified client string. Either both are omitted
// (unattached upload, allowed) or both must resolve to a real registered
// field. "entities-and-read-models" is for server-side callers only: a client upload must
// never name a projection entity, whose rows nobody can write-check.
export function resolveAttachedField(
  registry: Registry | undefined,
  entityType: string | undefined,
  fieldName: string | undefined,
  attachTargets: AttachTargets = "entities",
): AttachedFieldResolution {
  if (entityType === undefined && fieldName === undefined) return { kind: "unattached" };
  const entity =
    entityType !== undefined
      ? (registry?.getEntity(entityType) ??
        (attachTargets === "entities-and-read-models"
          ? registry?.getReadModelEntity(entityType)
          : undefined))
      : undefined;
  const fieldDef = entity && fieldName !== undefined ? entity.fields[fieldName] : undefined;
  if (!entityType || !fieldName || !entity || !fieldDef || !isFileField(fieldDef))
    return { kind: "unresolvable" };
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
  const { entityType, entityId, fieldName, actionForm } = input;
  if (actionForm === undefined) {
    return resolveAttachedField(registry, entityType, fieldName, attachTargets);
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

// Anonymous visitors share one user id and cannot bind, so only an opted-in field's
// pending upload (no record, no action form) is allowed.
export function isAnonymousPendingUploadAllowed(
  registry: Registry | undefined,
  target: UploadTarget,
): boolean {
  if (target.entityId !== undefined || target.actionForm !== undefined) return false;
  const resolution = resolveAttachedField(registry, target.entityType, target.fieldName);
  return resolution.kind === "resolved" && resolution.fieldDef.anonymousUpload === true;
}
