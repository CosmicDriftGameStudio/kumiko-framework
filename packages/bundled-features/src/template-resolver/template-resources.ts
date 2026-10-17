import { fetchOne } from "@cosmicdrift/kumiko-framework/bun-db";
import type {
  HandlerContext,
  SessionUser,
  TenantId,
  WriteResult,
} from "@cosmicdrift/kumiko-framework/engine";
import { NotFoundError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import { createFileRefFromBytes, fileRefsTable } from "@cosmicdrift/kumiko-framework/files";
import { fileContextForTenant } from "../file-foundation/index.js";
import { requireForTenant } from "../shared/index.js";
import { executor } from "./handlers/shared.js";
import type { LinkedResourceEntry } from "./linked-resources.js";
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
  if (!row) return null;
  const handle = ctx.files.refFromFileRef(row);
  if (!(await handle.exists())) return null;
  return { fileName: row.fileName, contentType: row.mimeType, bytes: await handle.read() };
}

// Gives the target tenant its own copy of every file behind the entries, so a template that was
// copied from the system default keeps working once the tenant exports it or measures its
// attachments. Rendered-PDF links carry no file and pass through. An entry whose source file is
// gone is left out: it could not be resolved at render time either.
export async function duplicateLinkedResourceFiles(
  ctx: HandlerContext,
  args: {
    readonly user: SessionUser;
    readonly tenantId: TenantId;
    readonly resources: Readonly<Record<string, LinkedResourceEntry>>;
  },
): Promise<WriteResult<Record<string, LinkedResourceEntry>>> {
  const { user, tenantId } = args;
  const { db } = requireForTenant(ctx, tenantId);
  const copies: Record<string, LinkedResourceEntry> = {};
  for (const [key, entry] of Object.entries(args.resources)) {
    if (typeof entry !== "string" && entry.kind === "rendered-pdf") {
      copies[key] = entry;
      continue;
    }
    const sourceFileRefId = typeof entry === "string" ? entry : entry.fileRefId;
    const file = await readTemplateResource(ctx, sourceFileRefId);
    // skip: the source file is gone, there is nothing to copy
    if (file === null) continue;
    const created = await createFileRefFromBytes(
      {
        db,
        files: fileContextForTenant(ctx, ctx.user.tenantId, tenantId),
        registry: ctx.registry,
        user: { ...user, tenantId },
      },
      { fileName: file.fileName, mimeType: file.contentType, data: file.bytes },
    );
    if (!created.isSuccess) return created;
    copies[key] =
      typeof entry === "string" ? created.data.id : { ...entry, fileRefId: created.data.id };
  }
  return { isSuccess: true, data: copies };
}

// Replaces the whole key map of one row with files that are already stored (bundle import,
// copy-locale). Single keys go through storeTemplateResource and resource-remove.
export async function attachTemplateResources(
  ctx: Pick<HandlerContext, "forTenant">,
  args: {
    readonly user: SessionUser;
    readonly tenantId: TenantId;
    readonly templateId: string;
    readonly resources: Readonly<Record<string, LinkedResourceEntry>>;
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
