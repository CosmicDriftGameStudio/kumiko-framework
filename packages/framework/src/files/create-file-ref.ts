import { createEventStoreExecutor } from "../db/event-store-executor.ts";
import type { TenantDb } from "../db/tenant-db.ts";
import { runInOwnTransaction } from "../db/tenant-db-scoped-rebind.ts";
import type { Registry, SessionUser } from "../engine/types/index.ts";

import { InternalError, type WriteFailure } from "../errors/index.ts";
import { generateId } from "../utils/index.ts";
import { FILE_REF_ENTITY_NAME, fileRefEntity } from "./file-ref-entity.ts";
import { fileRefsTable } from "./file-ref-table.ts";
import { resolveContentType } from "./resolve-content-type.ts";
import {
  buildStorageKey,
  resolveUploadMimeType,
  validateFile,
  validateFileContent,
} from "./types.ts";
import { type AttachTargets, resolveUploadField } from "./upload-field-resolution.ts";
import { takeUploadLedgerEntry } from "./upload-ledger.ts";

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

const ACTION_FORM_STORAGE_SEGMENT = "action-form";

const SAFE_IDENTIFIER = /^[A-Za-z0-9_-]+$/;

export type StoreFileInput = {
  readonly fileName: string;
  readonly declaredMimeType: string;
  readonly data: Uint8Array;
  readonly entityType?: string | undefined;
  readonly entityId?: string | undefined;
  readonly fieldName?: string | undefined;
  /** Qualified name of a registered actionForm screen; `fieldName` then names one of its files
   *  fields and the upload is stored as pending (entityType = the screen QN, no entityId). */
  readonly actionForm?: string | undefined;
};

export type StoreFileDeps = {
  readonly user: SessionUser;
  readonly tenantDb: TenantDb;
  // Set when tenantDb is not inside a transaction: event append, row and custom projections of
  // fileRef.created then commit together or not at all, so a failing projection leaves no row.
  readonly rowInOwnTransaction?: boolean;
  readonly registry: Registry | undefined;
  readonly attachTargets?: AttachTargets;
  readonly defaultMaxUploadSize: string | number;
  // Must record the upload in the ledger before the bytes land (FileContext.writeUploadBytes).
  readonly writeBytes: (storageKey: string, data: Uint8Array, mimeType: string) => Promise<void>;
  // Must drop the upload-ledger row together with the bytes.
  readonly deleteBytes: (storageKey: string) => Promise<void>;
  // Re-read in the transaction that inserts the row: the record can be locked while the bytes upload.
  readonly isAttachTargetLocked?: (rowDb: TenantDb) => Promise<boolean>;
};

class AttachTargetLockedError extends Error {}

export type CreatedFileRef = {
  readonly id: string;
  readonly fileName: string;
  readonly mimeType: string;
  readonly size: number;
  readonly storageKey: string;
};

export type UploadedFileBytes = {
  readonly storageKey: string;
  readonly fileName: string;
  readonly mimeType: string;
  readonly size: number;
  readonly entityType?: string | undefined;
  readonly entityId?: string | undefined;
  readonly fieldName?: string | undefined;
};

export type UploadBytesOutcome =
  | { readonly kind: "uploaded"; readonly uploaded: UploadedFileBytes }
  | { readonly kind: "rejected"; readonly error: string };

export type StoreFileOutcome =
  | { readonly kind: "created"; readonly fileRef: CreatedFileRef }
  | { readonly kind: "rejected"; readonly error: string }
  | { readonly kind: "target-locked" }
  | { readonly kind: "failed"; readonly failure: WriteFailure };

type AcceptedFile =
  | { readonly kind: "accepted"; readonly mimeType: string; readonly extension: string | undefined }
  | { readonly kind: "rejected"; readonly error: string };

function acceptFile(
  deps: Pick<StoreFileDeps, "registry" | "attachTargets" | "defaultMaxUploadSize">,
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

  const field = resolveUploadField(deps.registry, input, deps.attachTargets);
  if (field.kind === "rejected") return field;
  if (field.kind === "unresolvable") {
    return rejected(
      "unresolvable_field: entityType/fieldName must resolve to a registered file field, or both must be omitted for an unattached upload",
    );
  }
  const fieldDef = field.kind === "resolved" ? field.fieldDef : undefined;
  const maxSize = fieldDef?.maxSize || deps.defaultMaxUploadSize;
  const accept = fieldDef?.accept;

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

// Upload step: validates and writes the binary. Outside any transaction on purpose — network/disk
// I/O doesn't belong inside a PG connection's tx window.
export async function writeAcceptedFileBytes(
  deps: Pick<
    StoreFileDeps,
    "user" | "registry" | "attachTargets" | "defaultMaxUploadSize" | "writeBytes"
  >,
  input: StoreFileInput,
): Promise<UploadBytesOutcome> {
  const { fileName, data, entityType, entityId, fieldName, actionForm } = input;
  const accepted = acceptFile(deps, input);
  if (accepted.kind === "rejected") return accepted;
  const { mimeType, extension } = accepted;

  const storageKey = buildStorageKey(
    deps.user.tenantId,
    // The screen QN stays out of the key: a fixed segment keeps it a plain path part.
    actionForm !== undefined ? ACTION_FORM_STORAGE_SEGMENT : (entityType ?? "unattached"),
    entityId,
    fieldName ?? "file",
    fileName,
    generateId(),
    extension,
  );
  await deps.writeBytes(storageKey, data, mimeType);

  return {
    kind: "uploaded",
    uploaded: {
      storageKey,
      fileName,
      mimeType,
      size: data.byteLength,
      entityType: actionForm ?? entityType,
      entityId,
      fieldName,
    },
  };
}

// Row step: id is explicit so the response + storageKey stay consistent; tenantId, insertedAt and
// insertedById are set by applyEntityEvent from the event metadata.
export async function createFileRefRow(
  deps: Pick<StoreFileDeps, "user" | "tenantDb">,
  uploaded: UploadedFileBytes,
): Promise<{ readonly fileRef: CreatedFileRef } | { readonly failure: WriteFailure }> {
  const fileRefId = generateId();
  const result = await getFileRefExecutor().create(
    {
      id: fileRefId,
      storageKey: uploaded.storageKey,
      fileName: uploaded.fileName,
      mimeType: uploaded.mimeType,
      size: uploaded.size,
      entityType: uploaded.entityType ?? null,
      entityId: uploaded.entityId ?? null,
      fieldName: uploaded.fieldName ?? null,
    },
    deps.user,
    deps.tenantDb,
  );
  if (!result.isSuccess) return { failure: result };
  // Throws instead of returning a failure: a returned failure would still commit in the
  // own-transaction path, leaving a fileRef row whose bytes the sweep already deleted.
  if (!(await takeUploadLedgerEntry(deps.tenantDb, uploaded.storageKey))) {
    throw new InternalError({
      message:
        "upload expired: the bytes were swept before the fileRef row was created, upload again",
    });
  }
  return {
    fileRef: {
      id: fileRefId,
      fileName: uploaded.fileName,
      mimeType: uploaded.mimeType,
      size: uploaded.size,
      storageKey: uploaded.storageKey,
    },
  };
}

// The one upload pipeline behind POST /files and createFileRefFromBytes.
export async function storeFileAsFileRef(
  deps: StoreFileDeps,
  input: StoreFileInput,
): Promise<StoreFileOutcome> {
  const upload = await writeAcceptedFileBytes(deps, input);
  if (upload.kind === "rejected") return upload;

  // A failed create deletes the bytes again; a later rollback of an enclosing transaction or a
  // crash cannot, so the upload ledger sweep removes those bytes after its grace period.
  // Losing a row on append-failure is acceptable; a committed row with a missing binary is not.
  // A throwing projection on fileRef.created fails the create by exception, not by WriteFailure.
  const deleteUploadedBytes = async (): Promise<void> => {
    try {
      await deps.deleteBytes(upload.uploaded.storageKey);
    } catch {
      // skip: the create failure is the error worth reporting; the leftover bytes stay in storage.
    }
  };
  const createRow = async (rowDb: TenantDb) => {
    if (await deps.isAttachTargetLocked?.(rowDb)) throw new AttachTargetLockedError();
    return createFileRefRow({ user: deps.user, tenantDb: rowDb }, upload.uploaded);
  };
  let row: Awaited<ReturnType<typeof createFileRefRow>>;
  try {
    row = deps.rowInOwnTransaction
      ? await runInOwnTransaction(deps.tenantDb, createRow)
      : await createRow(deps.tenantDb);
  } catch (e) {
    await deleteUploadedBytes();
    if (e instanceof AttachTargetLockedError) return { kind: "target-locked" };
    throw e;
  }
  if ("failure" in row) {
    await deleteUploadedBytes();
    return { kind: "failed", failure: row.failure };
  }
  return { kind: "created", fileRef: row.fileRef };
}
