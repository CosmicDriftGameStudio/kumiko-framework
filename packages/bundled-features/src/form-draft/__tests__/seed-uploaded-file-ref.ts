import { createEventStoreExecutor, type DbConnection } from "@cosmicdrift/kumiko-framework/db";
import type { SessionUser } from "@cosmicdrift/kumiko-framework/engine";
import {
  FILE_REF_ENTITY_NAME,
  fileRefEntity,
  fileRefsTable,
} from "@cosmicdrift/kumiko-framework/files";
import { createTenantDb } from "@cosmicdrift/kumiko-framework/internal/row-level-security";

const fileRefExecutor = createEventStoreExecutor(fileRefsTable, fileRefEntity, {
  entityName: FILE_REF_ENTITY_NAME,
});

// Created as the uploader, so the row is owned the way a POST /files upload leaves it.
export async function seedUploadedFileRef(
  db: DbConnection,
  storageKey: string,
  uploader: SessionUser,
  boundToEntityId?: string,
): Promise<void> {
  const result = await fileRefExecutor.create(
    {
      storageKey,
      fileName: "photo.jpg",
      mimeType: "image/jpeg",
      size: 3,
      ...(boundToEntityId !== undefined && { entityId: boundToEntityId }),
    },
    uploader,
    createTenantDb({ db, tenantId: uploader.tenantId }),
  );
  if (!result.isSuccess) throw new Error(`seed fileRef failed: ${result.error.code}`);
}
