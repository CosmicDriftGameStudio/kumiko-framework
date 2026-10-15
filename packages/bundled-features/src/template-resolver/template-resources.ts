import { fetchOne } from "@cosmicdrift/kumiko-framework/bun-db";
import type {
  HandlerContext,
  SessionUser,
  TenantId,
  WriteResult,
} from "@cosmicdrift/kumiko-framework/engine";
import { NotFoundError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import { createFileRefFromBytes, fileRefsTable } from "@cosmicdrift/kumiko-framework/files";
import { requireForTenant } from "../shared/index.js";
import { executor } from "./handlers/shared.js";
import { type TemplateResourceRow, templateResourcesTable } from "./table.js";

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

// Interim: bundle import and copy-locale are the only writers of linkedResources
// until the resource upload path lands and takes this function over.
export async function attachTemplateResources(
  ctx: Pick<HandlerContext, "forTenant">,
  args: {
    readonly user: SessionUser;
    readonly tenantId: TenantId;
    readonly templateId: string;
    /** resource key -> fileRef id */
    readonly resources: Readonly<Record<string, string>>;
  },
): Promise<WriteResult<null>> {
  if (Object.keys(args.resources).length === 0) return { isSuccess: true, data: null };
  const { db, streamTenantId } = requireForTenant(ctx, args.tenantId);
  const row = await fetchOne<TemplateResourceRow>(db, templateResourcesTable, {
    id: args.templateId,
    tenantId: args.tenantId,
  });
  if (!row) return writeFailure(new NotFoundError("template-resource", args.templateId));
  const result = await executor.update(
    {
      id: row.id,
      version: row.version,
      changes: { linkedResources: JSON.stringify(args.resources) },
    },
    args.user,
    db,
    { streamTenantId },
  );
  return result.isSuccess ? { isSuccess: true, data: null } : result;
}
