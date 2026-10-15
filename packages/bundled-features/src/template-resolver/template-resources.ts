import { fetchOne } from "@cosmicdrift/kumiko-framework/bun-db";
import type { HandlerContext, WriteResult } from "@cosmicdrift/kumiko-framework/engine";
import { createFileRefFromBytes, fileRefsTable } from "@cosmicdrift/kumiko-framework/files";

export type TemplateResourceFile = {
  readonly fileName: string;
  readonly contentType: string;
  readonly bytes: Uint8Array;
};

type FileRefRow = {
  readonly storageKey: string;
  readonly fileName: string;
  readonly mimeType: string;
};

type TemplateResourceContext = Pick<HandlerContext, "db" | "files" | "registry" | "user">;

// Reads the file behind a template resource. Null when the fileRef is unknown
// to the caller's tenant or has no bytes.
export async function readTemplateResource(
  ctx: Pick<HandlerContext, "db" | "files" | "user">,
  fileRefId: string,
): Promise<TemplateResourceFile | null> {
  if (!ctx.files) return null;
  const row = await fetchOne<FileRefRow>(ctx.db, fileRefsTable, {
    id: fileRefId,
    isDeleted: false,
  });
  // ctx.files only reaches the caller's own key space.
  if (!row?.storageKey.startsWith(`${ctx.user.tenantId}/`)) return null;
  const handle = ctx.files.ref(row.storageKey);
  if (!(await handle.exists())) return null;
  return { fileName: row.fileName, contentType: row.mimeType, bytes: await handle.read() };
}

// Stores a resource file under the caller's tenant; the success data is the
// fileRef id that linkedResources points at.
export async function storeTemplateResource(
  ctx: TemplateResourceContext,
  file: TemplateResourceFile,
): Promise<WriteResult<string>> {
  const result = await createFileRefFromBytes(ctx, {
    fileName: file.fileName,
    mimeType: file.contentType,
    data: file.bytes,
  });
  return result.isSuccess ? { isSuccess: true, data: result.data.id } : result;
}
