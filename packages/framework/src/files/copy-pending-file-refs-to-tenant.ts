import type { WriteResult } from "@cosmicdrift/kumiko-types/handlers";
import type { TenantDb } from "../db/tenant-db.ts";
import type { Registry, SessionUser } from "../engine/types/index.ts";
import {
  FrameworkReasons,
  InternalError,
  reraiseAsKumikoError,
  UnprocessableError,
  writeFailure,
} from "../errors/index.ts";
import { bindPendingFileRef, loadPendingFileRef } from "./bind-pending-file-refs.ts";
import { getFileRefExecutor } from "./create-file-ref.ts";
import { createFileRefFromBytes } from "./create-file-ref-from-bytes.ts";
import type { FileContext } from "./file-handle.ts";

export type PendingUploadSource = {
  readonly db: TenantDb;
  readonly user: SessionUser;
  readonly files: FileContext | undefined;
  /** Where the upload is pending: the actionForm screen QN and its files field. */
  readonly entityType: string;
  readonly fieldName: string;
};

export type FileRefCopyTarget = {
  readonly db: TenantDb;
  readonly user: SessionUser;
  readonly registry: Registry;
  readonly files: FileContext | undefined;
  readonly attachTo: {
    readonly entityType: string;
    readonly fieldName: string;
    readonly entityId: string;
  };
};

type PendingUpload = {
  readonly id: string;
  readonly storageKey: string;
  readonly mimeType: string;
  readonly fileName: string;
};

function fileNotPending(fileRefId: string) {
  return writeFailure(
    new UnprocessableError(FrameworkReasons.fileRejected, {
      details: { error: `file ${fileRefId} is not a pending upload of the caller` },
    }),
  );
}

// Cross-tenant copy reads and re-stores the bytes, so the target field's accept/maxSize apply and
// the source uploads are deleted afterwards; within one tenant the uploads are bound in place.
export async function copyPendingFileRefsToTenant(args: {
  readonly source: PendingUploadSource;
  readonly target: FileRefCopyTarget;
  readonly fileIds: readonly string[];
}): Promise<WriteResult<readonly string[]>> {
  const { source, target } = args;
  const fileIds = [...new Set(args.fileIds)];
  if (source.user.tenantId === target.user.tenantId) {
    return bindInPlace(source, target, fileIds);
  }
  if (source.files === undefined || target.files === undefined) {
    return writeFailure(
      new InternalError({
        message: "copyPendingFileRefsToTenant: file storage is unavailable for source or target",
      }),
    );
  }
  const executor = getFileRefExecutor();
  const uploads: PendingUpload[] = [];
  for (const fileRefId of fileIds) {
    const pending = await loadPendingFileRef({
      fileRefId,
      entityName: source.entityType,
      fieldName: source.fieldName,
      user: source.user,
      db: source.db,
    });
    if (pending === undefined) return fileNotPending(fileRefId);
    // Read through the executor so an encrypted file name arrives as plain text.
    const detail = await executor.detail({ id: fileRefId }, source.user, source.db);
    if (detail === null) return fileNotPending(fileRefId);
    uploads.push({
      id: fileRefId,
      storageKey: pending.storageKey,
      mimeType: pending.mimeType,
      fileName: detail.fileName,
    });
  }

  const copiedIds: string[] = [];
  for (const upload of uploads) {
    const data = await source.files.ref(upload.storageKey).read();
    const created = await createFileRefFromBytes(
      {
        db: target.db,
        services: { files: target.files },
        registry: target.registry,
        user: target.user,
      },
      {
        fileName: upload.fileName,
        mimeType: upload.mimeType,
        data,
        attachTo: target.attachTo,
      },
    );
    if (!created.isSuccess) return created;
    copiedIds.push(created.data.id);
  }

  for (const upload of uploads) {
    const removed = await executor.delete({ id: upload.id }, source.user, source.db);
    if (!removed.isSuccess) throw reraiseAsKumikoError(removed.error);
  }
  return { isSuccess: true, data: copiedIds };
}

async function bindInPlace(
  source: PendingUploadSource,
  target: FileRefCopyTarget,
  fileIds: readonly string[],
): Promise<WriteResult<readonly string[]>> {
  for (const fileRefId of fileIds) {
    const outcome = await bindPendingFileRef({
      fileRefId,
      entityName: source.entityType,
      fieldName: source.fieldName,
      entityId: target.attachTo.entityId,
      bindTo: { entityName: target.attachTo.entityType, fieldName: target.attachTo.fieldName },
      registry: target.registry,
      user: source.user,
      db: source.db,
    });
    if (outcome !== "bound") return fileNotPending(fileRefId);
  }
  return { isSuccess: true, data: fileIds };
}
