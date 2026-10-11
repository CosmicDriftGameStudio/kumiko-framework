import { createEventStoreExecutor } from "../db/event-store-executor.js";
import type { TenantDb } from "../db/tenant-db.js";
import {
  type AnyFileFieldDef,
  isFileField,
  type Registry,
  type SessionUser,
} from "../engine/types/index.js";
import type { WriteFailure } from "../errors/index.js";
import { generateId } from "../utils/index.js";
import { FILE_REF_ENTITY_NAME, fileRefEntity } from "./file-ref-entity.js";
import { fileRefsTable } from "./file-ref-table.js";
import { resolveContentType } from "./resolve-content-type.js";
import {
  buildStorageKey,
  resolveUploadMimeType,
  validateFile,
  validateFileContent,
} from "./types.js";

export const DEFAULT_MAX_UPLOAD_SIZE = "10mb";

// Standard entity executor for fileRef: create/delete emit fileRef.created /
// fileRef.deleted and write file_refs via applyEntityEvent in one tx
// (read-your-own-write), exactly like any other entity's lifecycle. Built on
// first use: the table builder's import graph reaches back into this module.
let fileRefExecutor: ReturnType<typeof buildFileRefExecutor> | undefined;

function buildFileRefExecutor() {
  return createEventStoreExecutor(fileRefsTable, fileRefEntity, {
    entityName: FILE_REF_ENTITY_NAME,
  });
}

export function getFileRefExecutor(): ReturnType<typeof buildFileRefExecutor> {
  fileRefExecutor ??= buildFileRefExecutor();
  return fileRefExecutor;
}

const SAFE_IDENTIFIER = /^[A-Za-z0-9_-]+$/;

type AttachedFieldResolution =
  | { readonly kind: "unattached" }
  | { readonly kind: "resolved"; readonly fieldDef: AnyFileFieldDef }
  | { readonly kind: "unresolvable" };

// entityType/fieldName drive the GDPR-forget decision downstream
// (fileRefDeleteHook resolves the field's PII annotation from exactly this
// pairing) — attaching to a field nobody can resolve would leave that
// decision hanging on an unverified client string. Either both are omitted
// (unattached upload, allowed) or both must resolve to a real registered
// field.
export function resolveAttachedField(
  registry: Registry | undefined,
  entityType: string | undefined,
  fieldName: string | undefined,
): AttachedFieldResolution {
  if (entityType === undefined && fieldName === undefined) return { kind: "unattached" };
  const entity = entityType !== undefined ? registry?.getEntity(entityType) : undefined;
  const fieldDef = entity && fieldName !== undefined ? entity.fields[fieldName] : undefined;
  if (!entityType || !fieldName || !entity || !fieldDef || !isFileField(fieldDef))
    return { kind: "unresolvable" };
  return { kind: "resolved", fieldDef };
}

export type StoreFileInput = {
  readonly fileName: string;
  readonly declaredMimeType: string;
  readonly data: Uint8Array;
  readonly entityType?: string | undefined;
  readonly entityId?: string | undefined;
  readonly fieldName?: string | undefined;
};

export type StoreFileDeps = {
  readonly user: SessionUser;
  readonly tenantDb: TenantDb;
  readonly registry: Registry | undefined;
  readonly defaultMaxUploadSize: string;
  readonly writeBytes: (storageKey: string, data: Uint8Array, mimeType: string) => Promise<void>;
  readonly deleteBytes: (storageKey: string) => Promise<void>;
};

export type CreatedFileRef = {
  readonly id: string;
  readonly fileName: string;
  readonly mimeType: string;
  readonly size: number;
  readonly storageKey: string;
};

export type StoreFileOutcome =
  | { readonly kind: "created"; readonly fileRef: CreatedFileRef }
  | { readonly kind: "rejected"; readonly error: string }
  | { readonly kind: "failed"; readonly failure: WriteFailure };

type AcceptedFile =
  | { readonly kind: "accepted"; readonly mimeType: string; readonly extension: string | undefined }
  | { readonly kind: "rejected"; readonly error: string };

function acceptFile(
  deps: Pick<StoreFileDeps, "registry" | "defaultMaxUploadSize">,
  input: StoreFileInput,
): AcceptedFile {
  const { fileName, declaredMimeType, data, entityType, entityId, fieldName } = input;
  const rejected = (error: string): AcceptedFile => ({ kind: "rejected", error });

  // These interpolate directly into the storage key (buildStorageKey) —
  // reject anything but a safe identifier so a caller can't path-traverse
  // out of its tenant's storage prefix (../.. segments, absolute paths).
  for (const [field, value] of [
    ["entityType", entityType],
    ["entityId", entityId],
    ["fieldName", fieldName],
  ] as const) {
    if (value !== undefined && !SAFE_IDENTIFIER.test(value)) {
      return rejected(`invalid_${field}: must match /^[A-Za-z0-9_-]+$/`);
    }
  }

  let maxSize = deps.defaultMaxUploadSize;
  let accept: readonly string[] | undefined;

  const attachedField = resolveAttachedField(deps.registry, entityType, fieldName);
  if (attachedField.kind === "unresolvable") {
    return rejected(
      "unresolvable_field: entityType/fieldName must resolve to a registered file field, or both must be omitted for an unattached upload",
    );
  }
  if (attachedField.kind === "resolved") {
    if (attachedField.fieldDef.maxSize) maxSize = attachedField.fieldDef.maxSize;
    if (attachedField.fieldDef.accept) accept = attachedField.fieldDef.accept;
  }

  const validationError = validateFile(
    { fileName, mimeType: declaredMimeType, size: data.byteLength },
    { maxSize, accept },
  );
  if (validationError) return rejected(validationError);

  const contentValidation = validateFileContent(fileName, data, accept);
  if (contentValidation.kind === "rejected") return rejected(contentValidation.error);

  // A normalized upload's real type is already known from the sniffed
  // bytes — resolveUploadMimeType's alias/rewrite step only applies to the
  // declared mimeType of an unnormalized upload.
  if (contentValidation.kind === "normalized") {
    return {
      kind: "accepted",
      mimeType: contentValidation.mimeType,
      extension: contentValidation.extension,
    };
  }
  const mimeTypeResolution = resolveUploadMimeType(fileName, declaredMimeType, data);
  if (mimeTypeResolution.kind === "rejected") return rejected(mimeTypeResolution.error);
  return {
    kind: "accepted",
    mimeType: resolveContentType({
      declared: mimeTypeResolution.mimeType,
      bytes: data,
      filename: fileName,
    }),
    extension: undefined,
  };
}

// The one upload pipeline behind POST /files and createFileRefFromBytes.
export async function storeFileAsFileRef(
  deps: StoreFileDeps,
  input: StoreFileInput,
): Promise<StoreFileOutcome> {
  const { fileName, data, entityType, entityId, fieldName } = input;
  const accepted = acceptFile(deps, input);
  if (accepted.kind === "rejected") return accepted;
  const { mimeType, extension } = accepted;

  const fileRefId = generateId();
  const storageKey = buildStorageKey(
    deps.user.tenantId,
    entityType ?? "unattached",
    entityId,
    fieldName ?? "file",
    fileName,
    generateId(),
    extension,
  );

  // Write binary FIRST (outside the tx — network/disk I/O doesn't belong
  // inside a PG connection's tx window). A failed create deletes the bytes
  // again below; a later rollback of an enclosing transaction cannot, so
  // those are orphaned for the cleanup-jobs to sweep. Losing a row on
  // append-failure is acceptable; a committed row with a missing binary is not.
  await deps.writeBytes(storageKey, data, mimeType);

  // id is explicit so the response + storageKey stay consistent; tenantId,
  // insertedAt and insertedById are set by applyEntityEvent from the event metadata.
  const result = await getFileRefExecutor().create(
    {
      id: fileRefId,
      storageKey,
      fileName,
      mimeType,
      size: data.byteLength,
      entityType: entityType ?? null,
      entityId: entityId ?? null,
      fieldName: fieldName ?? null,
    },
    deps.user,
    deps.tenantDb,
  );
  if (!result.isSuccess) {
    try {
      await deps.deleteBytes(storageKey);
    } catch {
      // skip: the create failure is the error worth reporting; leftover bytes are swept by cleanup-jobs.
    }
    return { kind: "failed", failure: result };
  }

  return {
    kind: "created",
    fileRef: { id: fileRefId, fileName, mimeType, size: data.byteLength, storageKey },
  };
}
